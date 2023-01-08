# WalkingPad
Progamatically interact with your KingSmith WalkingPad over BLE.

*Not affiliated with Xiaomi, KingSmith or WalkingPad.*

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

## Thanks
Thanks to [ph4r05](https://github.com/ph4r05)'s [ph4-walkingpad](https://github.com/ph4r05/ph4-walkingpad) Python library for originally reverse engineering the WalkingPad BLE protocol.

## License
MIT
