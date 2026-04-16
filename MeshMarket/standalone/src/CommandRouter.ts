import type { TwitchChatManager } from "@sarxina/sarxina-tools";
import { ChatCommandManager } from "@sarxina/sarxina-tools";
import type { Wallet } from "./Wallet.js";
import type { AuctionManager, Bid } from "./Auction.js";
import type { VTSIntegration } from "./VTSIntegration.js";
import type { MeshUnit } from "./MeshUnitCatalog.js";
import { currentPrice } from "./PriceCalculator.js";
import { DEFAULT_BID_BUMP } from "./config.js";
import type { GameSpeed } from "./types.js";

const WELCOME_SUFFIX = "Get more MeshBucks with channel point rewards.";

interface DepsRouter {
    chat: TwitchChatManager;
    wallet: Wallet;
    auction: AuctionManager;
    vts: VTSIntegration;
    /** Streamer's login. Used to gate broadcaster-only subcommands. */
    broadcasterLogin: string;
    /** Game speed for price decay. Read live so changes via onConfigChange take effect immediately. */
    getSpeed: () => GameSpeed;
    /** Buyable units derived from the loaded model (or fallback flat list). */
    getUnits: () => readonly MeshUnit[];
    /** Toggle ambient tag display on the model. */
    toggleTags: (on: boolean) => Promise<void>;
    /** Whether tags are currently visible. */
    getTagsVisible: () => boolean;
}

export class CommandRouter {
    private say: (msg: string) => Promise<void>;

    constructor(private deps: DepsRouter) {
        this.say = deps.chat.say.bind(deps.chat);
        new ChatCommandManager("!meshmarket", (subcommand, chatter) => {
            void this.handle(subcommand, chatter);
        }, deps.chat);
    }

    private async handle(subcommand: string, chatter: string): Promise<void> {
        const login = chatter.toLowerCase();
        const parts = subcommand.trim().split(/\s+/).filter(Boolean);
        const verb = (parts[0] ?? "").toLowerCase();

        try {
            switch (verb) {
                case "":
                case "help":
                    await this.cmdHelp(chatter);
                    return;
                case "balance":
                case "bal":
                    await this.cmdBalance(chatter, login);
                    return;
                case "buy":
                    await this.cmdBuy(chatter, login, parts.slice(1));
                    return;
                case "list":
                    await this.cmdList(chatter);
                    return;
                case "owners":
                case "mine":
                    await this.cmdMine(chatter, login);
                    return;
                case "show":
                    await this.cmdSetVisible(chatter, login, true);
                    return;
                case "hide":
                    await this.cmdSetVisible(chatter, login, false);
                    return;
                default:
                    await this.say(`@${chatter} Unknown: try !meshmarket balance, !meshmarket buy <mesh> <#>, !meshmarket show/hide.`);
            }
        } catch (err) {
            console.error(`  MeshMarket: error handling "${subcommand}" from ${chatter}:`, err);
        }
    }

    // --- Commands ---

    private async cmdHelp(chatter: string): Promise<void> {
        await this.say(
            `@${chatter} !meshmarket balance | !meshmarket buy <mesh> <#> | !meshmarket mine | !meshmarket list | !meshmarket show/hide`,
        );
    }

    private async cmdBalance(chatter: string, login: string): Promise<void> {
        const { newEnrollment, balance } = this.deps.wallet.enroll(login);
        if (newEnrollment) {
            await this.say(
                `@${chatter} You are now enrolled in Mesh Market with ${balance} MeshBucks. ${WELCOME_SUFFIX}`,
            );
            return;
        }
        const owned = this.deps.wallet.meshesOwnedBy(login);
        const ownedStr = owned.length ? ` Owned: ${owned.length}.` : "";
        await this.say(`@${chatter} Balance: ${balance} MeshBucks.${ownedStr} ${WELCOME_SUFFIX}`);
    }

    private async cmdList(chatter: string): Promise<void> {
        const count = this.deps.getUnits().length;
        await this.say(
            `@${chatter} ${count} meshes available. Try \`!meshmarket buy <name>\` — if the name doesn't match, I'll suggest the closest ones.`,
        );
    }

    private async cmdMine(chatter: string, login: string): Promise<void> {
        this.deps.wallet.enroll(login);
        const owned = this.deps.wallet.meshesOwnedBy(login);
        if (!owned.length) {
            await this.say(`@${chatter} You don't own any meshes yet.`);
            return;
        }
        const now = Date.now();
        const summary = owned
            .slice(0, 8)
            .map((m) => `${m.meshID} (${currentPrice(m.state, now, this.deps.getSpeed())})`)
            .join(", ");
        const suffix = owned.length > 8 ? `, +${owned.length - 8} more` : "";
        await this.say(`@${chatter} You own: ${summary}${suffix}.`);
    }

    private async cmdSetVisible(chatter: string, login: string, visible: boolean): Promise<void> {
        if (login !== this.deps.broadcasterLogin.toLowerCase()) {
            await this.say(`@${chatter} Only the broadcaster can show/hide ownership tags.`);
            return;
        }
        await this.deps.toggleTags(visible);
        await this.say(visible ? "Ownership tags are now SHOWN on the model." : "Ownership tags are now HIDDEN.");
    }

    private async cmdBuy(chatter: string, login: string, args: string[]): Promise<void> {
        const meshArg = args[0];
        const amountArg = args[1];
        if (!meshArg) {
            await this.say(`@${chatter} Usage: !meshmarket buy <mesh> <#>`);
            return;
        }

        const unitId = this.resolveUnit(meshArg);
        if (!unitId) {
            const candidates = this.suggestUnits(meshArg, 5);
            if (candidates.length) {
                await this.say(
                    `@${chatter} No mesh "${meshArg}". Close matches: ${candidates.join(", ")}`,
                );
            } else {
                await this.say(`@${chatter} No mesh "${meshArg}" and no close matches found.`);
            }
            return;
        }

        this.deps.wallet.enroll(login);

        const now = Date.now();
        const meshState = this.deps.wallet.getMesh(unitId);
        const decayedPrice = currentPrice(meshState, now, this.deps.getSpeed());
        const isOwner = meshState?.owner === login;

        const existingAuction = this.deps.auction.getActive(unitId);
        const highBid = existingAuction?.bids[existingAuction.bids.length - 1] ?? null;
        const ceiling = highBid ? highBid.amount : decayedPrice;

        let bidAmount: number;
        if (amountArg !== undefined) {
            const parsed = parseInt(amountArg, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                await this.say(`@${chatter} Invalid amount "${amountArg}".`);
                return;
            }
            bidAmount = parsed;
        } else {
            bidAmount = ceiling + DEFAULT_BID_BUMP;
        }

        if (bidAmount <= ceiling) {
            await this.say(`@${chatter} Bid must exceed ${ceiling} MB (current ${highBid ? "high bid" : "price"}).`);
            return;
        }
        if (highBid && highBid.bidder === login) {
            await this.say(`@${chatter} You're already the top bidder at ${highBid.amount} MB.`);
            return;
        }
        if (isOwner && bidAmount <= decayedPrice) {
            await this.say(`@${chatter} As the owner, your bid must exceed the current price of ${decayedPrice} MB.`);
            return;
        }

        const reservedAmount = isOwner ? bidAmount - decayedPrice : bidAmount;

        const priorBid = this.findPriorBidBy(existingAuction?.bids, login);
        const effectiveBalance = this.deps.wallet.balanceOf(login) + (priorBid?.reservedAmount ?? 0);
        if (effectiveBalance < reservedAmount) {
            await this.say(
                `@${chatter} You need ${reservedAmount} MB to place this bid but have ${this.deps.wallet.balanceOf(login)}.`,
            );
            return;
        }

        if (priorBid) {
            this.deps.wallet.credit(login, priorBid.reservedAmount);
        }
        this.deps.wallet.debit(login, reservedAmount);

        const bid: Bid = {
            bidder: login,
            amount: bidAmount,
            reservedAmount,
            placedAtMs: now,
        };
        this.deps.auction.placeBid(unitId, bid);

        if (!existingAuction) {
            const ownerLabel = meshState?.owner ? `currently owned by ${meshState.owner}` : "unowned";
            await this.say(
                `@${chatter} is bidding ${bidAmount} MB on ${unitId} (${ownerLabel}). Outbid them with \`!meshmarket buy ${unitId} <#>\` in the next 60s!`,
            );
        } else {
            await this.say(
                `@${chatter} raises the bid on ${unitId} to ${bidAmount} MB — 60s reset, outbid now!`,
            );
        }
    }

    // --- Unit resolution helpers ---

    private resolveUnit(query: string): string | null {
        const q = query.toLowerCase();
        const exact = this.deps.getUnits().find((u) => u.id.toLowerCase() === q);
        return exact?.id ?? null;
    }

    private suggestUnits(query: string, limit: number): string[] {
        const q = query.toLowerCase();
        return this.deps
            .getUnits()
            .filter((u) => u.id.toLowerCase().includes(q))
            .map((u) => u.id)
            .slice(0, limit);
    }

    private findPriorBidBy(bids: readonly Bid[] | undefined, login: string): Bid | null {
        if (!bids || bids.length === 0) return null;
        for (let i = bids.length - 1; i >= 0; i--) {
            const b = bids[i]!;
            if (b.bidder === login) return b;
        }
        return null;
    }
}
