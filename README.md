# WalkingPad
Progamatically interact with your KingSmith WalkingPad over BLE.

## Installation
```
yarn add walkingpad
```

## Usage
```ts
import WalkingPad from 'walkingpad'

const walkingPad = new WalkingPad()

walkingPad.on('connected', () => {
	walkingPad.setMode('manual')
	walkingPad.setSpeed(2.50)
	walkingPad.start()

	setTimeout(() => {
		walkingPad.stop()
	}, 10000)
})

walkingPad.connect()
```

## License
MIT
