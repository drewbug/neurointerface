# neurointerface.js

Live Demo: https://ab3j.radio/neurointerface

Connect to wearable neural devices over Bluetooth from the browser or the command line.

## Install

```
$ npm install -g neurointerface
```

## Usage

```
$ neurointerface scan
```

### Mendi (fNIRS)

```
$ neurointerface read --device mendi
```

### Thync (tES)

```
$ neurointerface write --device thync --program calm --current 1.0 --minutes 10
```

```
$ neurointerface write --device thync --program energy --current 1.0 --minutes 10
```

### NeoRhythm (PEMF)

```
$ neurointerface write --device neorhythm --program alpha --minutes 20
```

```
$ neurointerface write --device neorhythm --program gamma --power 128 --coils all --minutes 60
```
