/**
 * Control schema types — mirrored from sarxina-plugin-manager's
 * `electron/toyControls.ts`. Kept in sync structurally rather than via a
 * shared package, since both repos already duplicate other shared types.
 */

export interface ControlBase {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
}

export interface SliderControl extends ControlBase {
    readonly type: "slider";
    readonly min: number;
    readonly max: number;
    readonly step?: number;
    readonly default: number;
}

export interface SelectControl extends ControlBase {
    readonly type: "select";
    readonly options: ReadonlyArray<{ readonly value: string | number; readonly label: string }>;
    readonly default: string | number;
}

export interface ToggleControl extends ControlBase {
    readonly type: "toggle";
    readonly default: boolean;
}

export type ToyControl = SliderControl | SelectControl | ToggleControl;
export type ToyControlSchema = readonly ToyControl[];
