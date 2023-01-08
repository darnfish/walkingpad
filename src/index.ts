import noble from '@abandonware/noble'
import EventEmitter from 'eventemitter3'

type WalkingPadMode = 'manual' | 'automatic' | 'standby'
type WalkingPadStatus = 'running' | 'stopped' | 'countdown-3' | 'countdown-2' | 'countdown-1'

interface WalkingPadState {
	status: WalkingPadStatus

	time: number
	speed: number
	steps: number
	distance: number
}

interface WalkingPadRawStatus {
	speed: number
	beltState: number
	manualMode: number
	time: number
	distance: number
	steps: number
	appSpeed: number
	controllerButton: number
}

interface WalkingPadCommand {
	buffer: Buffer
	sendAt: number
}

type WalkingPadConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'disconnecting'

function byteToInt(value: Buffer, width = 3) {
	const newValue: number[] = []
	for(let i = 0; i < width; i++)
		newValue.push((value.at(i) as number) << (8 * (width - 1 - i)))

	return newValue.reduce((a, b) => a + b)
}

const modes = {
	standby: 2,
	manual: 1,
	automatic: 0
}

const waitTime = 1000

export default class WalkingPad extends EventEmitter {
	connectionStatus: WalkingPadConnectionStatus

	private _state: WalkingPadRawStatus

	private peripheral: noble.Peripheral
	private send: noble.Characteristic
	private recv: noble.Characteristic

	private commandQueue: WalkingPadCommand[] = []
	private commandQueueInterval: NodeJS.Timer
	private lastCommandSentAt: number = Date.now()

	constructor() {
		super()

		this.commandQueueInterval = setInterval(async () => {
			if(this.connectionStatus !== 'connected')
				return

			if(this.commandQueue.length === 0)
				return

			const [latestItem] = this.commandQueue
			await this._write(latestItem.buffer)

			this.commandQueue.splice(0, 1)
		}, waitTime)

		this.connectionStatus = 'disconnected'
	}

	async connect() {		
		this.connectionStatus = 'connecting'

		if(noble.state === 'poweredOn')
			await noble.startScanningAsync([], false)
		else
			noble.on('stateChange', this.onStateChange)

		noble.on('discover', this.onPeripheralDiscover)
	}

	private onStateChange = async (state: string) => {
		if(state !== 'poweredOn')
			return

		await noble.startScanningAsync([], false)

		noble.removeListener('stateChange', this.onStateChange)
	}

	private onPeripheralDiscover = async (peripheral: noble.Peripheral) => {
		if(this.connectionStatus !== 'connecting')
			return

		if(peripheral.advertisement.localName !== 'WalkingPad')
			return

		this.peripheral = peripheral
	
		await noble.stopScanningAsync()
	
		this.peripheral.addListener('connect', this.onPeripheralConnect)
		this.peripheral.addListener('disconnect', this.onPeripheralDisconnect)
	
		await this.peripheral.connectAsync()
	}

	private onPeripheralConnect = async () => {
		this.connectionStatus = 'connected'

		/**
		 * Discover Characteristics
		 */
		const { services } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync()
		for(const service of services)
			for(const characteristic of service.characteristics) {
				if(characteristic.uuid.startsWith('fe01'))
					this.recv = characteristic

				if(characteristic.uuid.startsWith('fe02'))
					this.send = characteristic
			}

		/**
		 * Enable Notify
		 */
		await this.recv.notifyAsync(true)

		this.recv.addListener('data', this.onRecvCharacteristicData)
		this.send.addListener('write', this.onSendCharacteristicWrite)

		this.emit('connected')
	}

	private onRecvCharacteristicData = (data: Buffer) => {
		if(data[0] === 248 && data[1] === 162) {
			const beltState = data[2]
			const speed = data[3]
			const manualMode = data[4]

			const time = byteToInt(data.slice(5))
			const distance = byteToInt(data.slice(8))
			const steps = byteToInt(data.slice(11))

			const appSpeed = data[14]
			const controllerButton = data[16]

			this._state = {
				speed,
				beltState,
				manualMode,
				time,
				distance,
				steps,
				appSpeed,
				controllerButton
			}

			this.emit('state_update', this.state)
		}
	}

	private onSendCharacteristicWrite = () => {
		this.lastCommandSentAt = Date.now()
	}

	private onPeripheralDisconnect = async () => {
		this.peripheral.removeListener('connect', this.onPeripheralConnect)
		this.peripheral.removeListener('disconnect', this.onPeripheralDisconnect)

		this.recv.removeListener('data', this.onRecvCharacteristicData)
		this.send.removeListener('write', this.onSendCharacteristicWrite)

		this.emit('disconnected')

		this.peripheral = null
		this.send = null
		this.recv = null

		this._state = null

		this.connectionStatus = 'disconnected'
	}

	disconnect() {
		this.peripheral.disconnectAsync()
		this.connectionStatus = 'disconnecting'
	}

	async start() {
		await this.write([247, 162, 4, 1, 0xff, 253])
	}

	async setMode(mode: WalkingPadMode) {
		if(!mode)
			return console.error('Mode not found')

		if(!['manual', 'automatic', 'standby'].includes(mode))
			return console.error(`Mode "${mode}" not supported`)

		await this.write([247, 162, 2, modes[mode], 0xff, 253])
	}

	async setSpeed(speed: number) {
		speed = speed / 0.0625

		await this.write([247, 162, 1, speed, 0xff, 253])
	}

	async stop() {
		await this.setSpeed(0)
	}

	private async write(bytes: number[]) {
		bytes[bytes.length - 2] = bytes.slice(1, bytes.length - 2).reduce((a, b) => a + b) % 256

		const buffer = Buffer.from(bytes)

		const shouldWait = waitTime > (Date.now() - this.lastCommandSentAt)
		if(shouldWait)
			return this.commandQueue.push({
				buffer,
				sendAt: this.lastCommandSentAt + waitTime
			})

		await this._write(buffer)
	}

	private async _write(buffer: Buffer) {
		await this.send.writeAsync(buffer, true)
	}

	get state(): WalkingPadState {
		if(!this._state)
			return null

		let status: WalkingPadStatus

		// beltState
		// 9 = countdown 3
		// 8 = countdown 2
		// 7 = countdown 1
		// 1 = running
		// 0 = stopped
		switch(this._state.beltState) {
		case 9:
			status = 'countdown-3'
			break
		case 8:
			status = 'countdown-2'
			break
		case 7:
			status = 'countdown-1'
			break
		case 1:
			status = 'running'
			break
		case 0:
		case 5:
			status = 'stopped'
			break
		}

		return {
			status,

			time: this._state.time * 1000,
			speed: this._state.speed * 0.0625,
			steps: this._state.steps,
			distance: this._state.distance
		}
	}

	get isWalking() {
		return this.state?.time > 0
	}
}
