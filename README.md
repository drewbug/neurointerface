# neurointerface.js

[![](npm.svg)](https://www.npmjs.com/package/neurointerface)

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
