import EventEmitter from 'eventemitter3';
type WalkingPadMode = 'manual' | 'automatic' | 'standby';
type WalkingPadStatus = 'running' | 'stopped' | 'countdown-3' | 'countdown-2' | 'countdown-1';
interface WalkingPadState {
    status: WalkingPadStatus;
    time: number;
    speed: number;
    steps: number;
    distance: number;
}
type WalkingPadConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'disconnecting';
export default class WalkingPad extends EventEmitter {
    connectionStatus: WalkingPadConnectionStatus;
    private _state;
    private peripheral;
    private send;
    private recv;
    private commandQueue;
    private commandQueueInterval;
    private lastCommandSentAt;
    constructor();
    connect(): Promise<void>;
    private onPeripheralDiscover;
    private onPeripheralConnect;
    private onRecvCharacteristicData;
    private onSendCharacteristicWrite;
    private onPeripheralDisconnect;
    disconnect(): void;
    start(): Promise<void>;
    setMode(mode: WalkingPadMode): Promise<void>;
    setSpeed(speed: number): Promise<void>;
    stop(): Promise<void>;
    private write;
    private _write;
    get state(): WalkingPadState;
    get isWalking(): boolean;
}
export {};
