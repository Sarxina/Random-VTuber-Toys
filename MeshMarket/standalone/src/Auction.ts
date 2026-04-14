import { BID_WINDOW_MS } from "./config.js";

export interface Bid {
    bidder: string;       // Twitch login
    /** The bid price — this becomes the new buyPrice on win. */
    amount: number;
    /** Funds actually reserved from the bidder's wallet. Equals amount for
     *  non-owner bidders; equals (amount - currentPriceAtBidTime) for the
     *  current owner (owner discount). */
    reservedAmount: number;
    placedAtMs: number;
}

interface ActiveAuction {
    meshID: string;
    bids: Bid[];
    timer: NodeJS.Timeout;
}

export interface AuctionResult {
    meshID: string;
    winner: Bid;
    losers: Bid[];  // earlier bids that got outbid — refund each reservedAmount
}

type ResolveListener = (result: AuctionResult) => void;

/**
 * Auction lifecycle:
 *   placeBid() starts a new 60s window or extends/resets an existing one.
 *   When the window expires, the highest bid wins and onResolve fires.
 *
 * Auction is intentionally money-agnostic — it holds Bid objects but never
 * touches a Wallet. The orchestrator (CommandRouter / index) reserves funds
 * *before* calling placeBid and settles funds *after* onResolve fires.
 */
export class AuctionManager {
    private active = new Map<string, ActiveAuction>();
    private resolveListeners: ResolveListener[] = [];

    getActive(meshID: string): { bids: readonly Bid[] } | null {
        const a = this.active.get(meshID);
        if (!a) return null;
        return { bids: a.bids };
    }

    /** Bid must already be validated (amount is legal, funds reserved). */
    placeBid(meshID: string, bid: Bid): void {
        const existing = this.active.get(meshID);
        if (existing) {
            existing.bids.push(bid);
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => this.resolve(meshID), BID_WINDOW_MS);
            return;
        }
        const auction: ActiveAuction = {
            meshID,
            bids: [bid],
            timer: setTimeout(() => this.resolve(meshID), BID_WINDOW_MS),
        };
        this.active.set(meshID, auction);
    }

    private resolve(meshID: string): void {
        const auction = this.active.get(meshID);
        if (!auction) return;
        this.active.delete(meshID);
        const winner = auction.bids[auction.bids.length - 1]!;
        const losers = auction.bids.slice(0, -1);
        this.resolveListeners.forEach((cb) => cb({ meshID, winner, losers }));
    }

    /** Force-close all active auctions. Called on toy stop. Returns results
     *  so the orchestrator can refund losers and settle the winning bid. */
    closeAll(): AuctionResult[] {
        const results: AuctionResult[] = [];
        for (const meshID of Array.from(this.active.keys())) {
            const auction = this.active.get(meshID)!;
            clearTimeout(auction.timer);
            this.active.delete(meshID);
            const winner = auction.bids[auction.bids.length - 1]!;
            const losers = auction.bids.slice(0, -1);
            results.push({ meshID, winner, losers });
        }
        return results;
    }

    onResolve(cb: ResolveListener): void {
        this.resolveListeners.push(cb);
    }
}
