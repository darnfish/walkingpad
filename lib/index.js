"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const noble_1 = __importDefault(require("@abandonware/noble"));
const eventemitter3_1 = __importDefault(require("eventemitter3"));
function byteToInt(value, width = 3) {
    const newValue = [];
    for (let i = 0; i < width; i++)
        newValue.push(value.at(i) << (8 * (width - 1 - i)));
    return newValue.reduce((a, b) => a + b);
}
const modes = {
    standby: 2,
    manual: 1,
    automatic: 0
};
const waitTime = 1000;
class WalkingPad extends eventemitter3_1.default {
    constructor() {
        super();
        this.commandQueue = [];
        this.lastCommandSentAt = Date.now();
        this.onPeripheralDiscover = async (peripheral) => {
            if (this.connectionStatus !== 'connecting')
                return;
            if (peripheral.advertisement.localName !== 'WalkingPad')
                return;
            this.peripheral = peripheral;
            console.log('[wp] [ble] got peripheral!');
            await noble_1.default.stopScanningAsync();
            this.peripheral.addListener('connect', this.onPeripheralConnect);
            this.peripheral.addListener('disconnect', this.onPeripheralDisconnect);
            await this.peripheral.connectAsync();
        };
        this.onPeripheralConnect = async () => {
            this.connectionStatus = 'connected';
            console.log('[wp] [ble] connected to pperipheral');
            /**
             * Discover Characteristics
             */
            const { services } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();
            for (const service of services)
                for (const characteristic of service.characteristics) {
                    if (characteristic.uuid.startsWith('fe01')) {
                        this.recv = characteristic;
                        console.log('[wp] [ble] got fe01 characteristic!');
                    }
                    if (characteristic.uuid.startsWith('fe02')) {
                        this.send = characteristic;
                        console.log('[wp] [ble] got fe02 characteristic!');
                    }
                }
            /**
             * Enable Notify
             */
            await this.recv.notifyAsync(true);
            this.recv.addListener('data', this.onRecvCharacteristicData);
            this.send.addListener('write', this.onSendCharacteristicWrite);
        };
        this.onRecvCharacteristicData = (data, isNotification) => {
            if (data[0] === 248 && data[1] === 162) {
                const beltState = data[2];
                const speed = data[3];
                const manualMode = data[4];
                const time = byteToInt(data.slice(5));
                const distance = byteToInt(data.slice(8));
                const steps = byteToInt(data.slice(11));
                const appSpeed = data[14];
                const controllerButton = data[16];
                this._state = {
                    speed,
                    beltState,
                    manualMode,
                    time,
                    distance,
                    steps,
                    appSpeed,
                    controllerButton
                };
                console.log(JSON.stringify(this.state));
                this.emit('state_update', this.state);
            }
        };
        this.onSendCharacteristicWrite = () => {
            this.lastCommandSentAt = Date.now();
        };
        this.onPeripheralDisconnect = async () => {
            console.log('Disconnected');
            this.peripheral.removeListener('connect', this.onPeripheralConnect);
            this.peripheral.removeListener('disconnect', this.onPeripheralDisconnect);
            this.recv.removeListener('data', this.onRecvCharacteristicData);
            this.send.removeListener('write', this.onSendCharacteristicWrite);
            this.peripheral = null;
            this.send = null;
            this.recv = null;
            this._state = null;
            this.connectionStatus = 'disconnected';
        };
        this.commandQueueInterval = setInterval(async () => {
            if (this.connectionStatus !== 'connected')
                return;
            if (this.commandQueue.length === 0)
                return;
            const [latestItem] = this.commandQueue;
            await this._write(latestItem.buffer);
            this.commandQueue.splice(0, 1);
        }, waitTime);
        this.connectionStatus = 'disconnected';
    }
    async connect() {
        this.connectionStatus = 'connecting';
        console.log('[wp] [ble] connecting...');
        if (noble_1.default.state === 'poweredOn')
            await noble_1.default.startScanningAsync([], false);
        else {
            async function onStateChange(state) {
                if (state !== 'poweredOn')
                    return;
                await noble_1.default.startScanningAsync([], false);
                noble_1.default.removeListener('stateChange', onStateChange);
            }
            noble_1.default.on('stateChange', onStateChange);
        }
        noble_1.default.on('discover', this.onPeripheralDiscover);
    }
    disconnect() {
        this.peripheral.disconnectAsync();
        this.connectionStatus = 'disconnecting';
    }
    async start() {
        await this.write([247, 162, 4, 1, 0xff, 253]);
    }
    async setMode(mode) {
        if (!mode)
            return console.error('Mode not found');
        if (!['manual', 'automatic', 'standby'].includes(mode))
            return console.error(`Mode "${mode}" not supported`);
        await this.write([247, 162, 2, modes[mode], 0xff, 253]);
    }
    async setSpeed(speed) {
        speed = speed / 0.0625;
        await this.write([247, 162, 1, speed, 0xff, 253]);
    }
    async stop() {
        await this.setSpeed(0);
    }
    async write(bytes) {
        bytes[bytes.length - 2] = bytes.slice(1, bytes.length - 2).reduce((a, b) => a + b) % 256;
        const buffer = Buffer.from(bytes);
        const shouldWait = waitTime > (Date.now() - this.lastCommandSentAt);
        console.log({ shouldWait });
        if (shouldWait)
            return this.commandQueue.push({
                buffer,
                sendAt: this.lastCommandSentAt + waitTime
            });
        await this._write(buffer);
    }
    async _write(buffer) {
        console.log('sending', Uint8Array.from(buffer));
        await this.send.writeAsync(buffer, true);
    }
    get state() {
        if (!this._state)
            return null;
        let status;
        // beltState
        // 9 = countdown 3
        // 8 = countdown 2
        // 7 = countdown 1
        // 1 = running
        // 0 = stopped
        switch (this._state.beltState) {
            case 9:
                status = 'countdown-3';
                break;
            case 8:
                status = 'countdown-2';
                break;
            case 7:
                status = 'countdown-1';
                break;
            case 1:
                status = 'running';
                break;
            case 0:
            case 5:
                status = 'stopped';
                break;
        }
        return {
            status,
            time: this._state.time * 1000,
            speed: this._state.speed * 0.0625,
            steps: this._state.steps,
            distance: this._state.distance
        };
    }
    get isWalking() {
        var _a;
        return ((_a = this.state) === null || _a === void 0 ? void 0 : _a.time) > 0;
    }
}
exports.default = WalkingPad;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSwrREFBc0M7QUFDdEMsa0VBQXdDO0FBZ0N4QyxTQUFTLFNBQVMsQ0FBQyxLQUFhLEVBQUUsS0FBSyxHQUFHLENBQUM7SUFDMUMsTUFBTSxRQUFRLEdBQWEsRUFBRSxDQUFBO0lBQzdCLEtBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFO1FBQzVCLFFBQVEsQ0FBQyxJQUFJLENBQUUsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQVksSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBRWhFLE9BQU8sUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtBQUN4QyxDQUFDO0FBRUQsTUFBTSxLQUFLLEdBQUc7SUFDYixPQUFPLEVBQUUsQ0FBQztJQUNWLE1BQU0sRUFBRSxDQUFDO0lBQ1QsU0FBUyxFQUFFLENBQUM7Q0FDWixDQUFBO0FBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFBO0FBRXJCLE1BQXFCLFVBQVcsU0FBUSx1QkFBWTtJQWFuRDtRQUNDLEtBQUssRUFBRSxDQUFBO1FBTEEsaUJBQVksR0FBd0IsRUFBRSxDQUFBO1FBRXRDLHNCQUFpQixHQUFXLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQTtRQTRDdEMseUJBQW9CLEdBQUcsS0FBSyxFQUFFLFVBQTRCLEVBQUUsRUFBRTtZQUNyRSxJQUFHLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxZQUFZO2dCQUN4QyxPQUFNO1lBRVAsSUFBRyxVQUFVLENBQUMsYUFBYSxDQUFDLFNBQVMsS0FBSyxZQUFZO2dCQUNyRCxPQUFNO1lBRVAsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7WUFFNUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO1lBRXpDLE1BQU0sZUFBSyxDQUFDLGlCQUFpQixFQUFFLENBQUE7WUFFL0IsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO1lBQ2hFLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtZQUV0RSxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLENBQUE7UUFDckMsQ0FBQyxDQUFBO1FBRU8sd0JBQW1CLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDeEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLFdBQVcsQ0FBQTtZQUVuQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxDQUFDLENBQUE7WUFFbEQ7O2VBRUc7WUFDSCxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLDBDQUEwQyxFQUFFLENBQUE7WUFDdkYsS0FBSSxNQUFNLE9BQU8sSUFBSSxRQUFRO2dCQUM1QixLQUFJLE1BQU0sY0FBYyxJQUFJLE9BQU8sQ0FBQyxlQUFlLEVBQUU7b0JBQ3BELElBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLEVBQUU7d0JBQzFDLElBQUksQ0FBQyxJQUFJLEdBQUcsY0FBYyxDQUFBO3dCQUMxQixPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxDQUFDLENBQUE7cUJBQ2xEO29CQUVELElBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLEVBQUU7d0JBQzFDLElBQUksQ0FBQyxJQUFJLEdBQUcsY0FBYyxDQUFBO3dCQUMxQixPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxDQUFDLENBQUE7cUJBQ2xEO2lCQUNEO1lBRUY7O2VBRUc7WUFDSCxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBRWpDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtZQUM1RCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFDL0QsQ0FBQyxDQUFBO1FBRU8sNkJBQXdCLEdBQUcsQ0FBQyxJQUFZLEVBQUUsY0FBdUIsRUFBRSxFQUFFO1lBQzVFLElBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLEdBQUcsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssR0FBRyxFQUFFO2dCQUN0QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUE7Z0JBQ3pCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQTtnQkFDckIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUUxQixNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUNyQyxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO2dCQUN6QyxNQUFNLEtBQUssR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFBO2dCQUV2QyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBQ3pCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFBO2dCQUVqQyxJQUFJLENBQUMsTUFBTSxHQUFHO29CQUNiLEtBQUs7b0JBQ0wsU0FBUztvQkFDVCxVQUFVO29CQUNWLElBQUk7b0JBQ0osUUFBUTtvQkFDUixLQUFLO29CQUNMLFFBQVE7b0JBQ1IsZ0JBQWdCO2lCQUNoQixDQUFBO2dCQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtnQkFFdkMsSUFBSSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO2FBQ3JDO1FBQ0YsQ0FBQyxDQUFBO1FBRU8sOEJBQXlCLEdBQUcsR0FBRyxFQUFFO1lBQ3hDLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUE7UUFDcEMsQ0FBQyxDQUFBO1FBRU8sMkJBQXNCLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDM0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQTtZQUUzQixJQUFJLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLENBQUE7WUFDbkUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1lBRXpFLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtZQUMvRCxJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUE7WUFFakUsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUE7WUFDdEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7WUFDaEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7WUFFaEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUE7WUFFbEIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGNBQWMsQ0FBQTtRQUN2QyxDQUFDLENBQUE7UUEzSUEsSUFBSSxDQUFDLG9CQUFvQixHQUFHLFdBQVcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNsRCxJQUFHLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxXQUFXO2dCQUN2QyxPQUFNO1lBRVAsSUFBRyxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDO2dCQUNoQyxPQUFNO1lBRVAsTUFBTSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUE7WUFDdEMsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUVwQyxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDL0IsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBRVosSUFBSSxDQUFDLGdCQUFnQixHQUFHLGNBQWMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU87UUFDWixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsWUFBWSxDQUFBO1FBRXBDLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLENBQUMsQ0FBQTtRQUV2QyxJQUFHLGVBQUssQ0FBQyxLQUFLLEtBQUssV0FBVztZQUM3QixNQUFNLGVBQUssQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUE7YUFDckM7WUFDSixLQUFLLFVBQVUsYUFBYSxDQUFDLEtBQWE7Z0JBQ3pDLElBQUcsS0FBSyxLQUFLLFdBQVc7b0JBQ3ZCLE9BQU07Z0JBRVAsTUFBTSxlQUFLLENBQUMsa0JBQWtCLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO2dCQUV6QyxlQUFLLENBQUMsY0FBYyxDQUFDLGFBQWEsRUFBRSxhQUFhLENBQUMsQ0FBQTtZQUNuRCxDQUFDO1lBRUQsZUFBSyxDQUFDLEVBQUUsQ0FBQyxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUE7U0FDdEM7UUFFRCxlQUFLLENBQUMsRUFBRSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0lBd0dELFVBQVU7UUFDVCxJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsRUFBRSxDQUFBO1FBQ2pDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxlQUFlLENBQUE7SUFDeEMsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLO1FBQ1YsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQzlDLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLElBQW9CO1FBQ2pDLElBQUcsQ0FBQyxJQUFJO1lBQ1AsT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFdkMsSUFBRyxDQUFDLENBQUMsUUFBUSxFQUFFLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO1lBQ3BELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxTQUFTLElBQUksaUJBQWlCLENBQUMsQ0FBQTtRQUVyRCxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUVELEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBYTtRQUMzQixLQUFLLEdBQUcsS0FBSyxHQUFHLE1BQU0sQ0FBQTtRQUV0QixNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJO1FBQ1QsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ3ZCLENBQUM7SUFFTyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQWU7UUFDbEMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFBO1FBRXhGLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFakMsTUFBTSxVQUFVLEdBQUcsUUFBUSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO1FBQ25FLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBQzNCLElBQUcsVUFBVTtZQUNaLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUM7Z0JBQzdCLE1BQU07Z0JBQ04sTUFBTSxFQUFFLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxRQUFRO2FBQ3pDLENBQUMsQ0FBQTtRQUVILE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUMxQixDQUFDO0lBRU8sS0FBSyxDQUFDLE1BQU0sQ0FBQyxNQUFjO1FBQ2xDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtRQUUvQyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQsSUFBSSxLQUFLO1FBQ1IsSUFBRyxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQ2QsT0FBTyxJQUFJLENBQUE7UUFFWixJQUFJLE1BQXdCLENBQUE7UUFFNUIsWUFBWTtRQUNaLGtCQUFrQjtRQUNsQixrQkFBa0I7UUFDbEIsa0JBQWtCO1FBQ2xCLGNBQWM7UUFDZCxjQUFjO1FBQ2QsUUFBTyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRTtZQUM5QixLQUFLLENBQUM7Z0JBQ0wsTUFBTSxHQUFHLGFBQWEsQ0FBQTtnQkFDdEIsTUFBSztZQUNOLEtBQUssQ0FBQztnQkFDTCxNQUFNLEdBQUcsYUFBYSxDQUFBO2dCQUN0QixNQUFLO1lBQ04sS0FBSyxDQUFDO2dCQUNMLE1BQU0sR0FBRyxhQUFhLENBQUE7Z0JBQ3RCLE1BQUs7WUFDTixLQUFLLENBQUM7Z0JBQ0wsTUFBTSxHQUFHLFNBQVMsQ0FBQTtnQkFDbEIsTUFBSztZQUNOLEtBQUssQ0FBQyxDQUFDO1lBQ1AsS0FBSyxDQUFDO2dCQUNMLE1BQU0sR0FBRyxTQUFTLENBQUE7Z0JBQ2xCLE1BQUs7U0FDTDtRQUVELE9BQU87WUFDTixNQUFNO1lBRU4sSUFBSSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxHQUFHLElBQUk7WUFDN0IsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxHQUFHLE1BQU07WUFDakMsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixRQUFRLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRO1NBQzlCLENBQUE7SUFDRixDQUFDO0lBRUQsSUFBSSxTQUFTOztRQUNaLE9BQU8sQ0FBQSxNQUFBLElBQUksQ0FBQyxLQUFLLDBDQUFFLElBQUksSUFBRyxDQUFDLENBQUE7SUFDNUIsQ0FBQztDQUNEO0FBNVBELDZCQTRQQyJ9