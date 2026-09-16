#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode-27-beta-6.app/Contents/Developer
mkdir -p build/M0Probe.app build/cache
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-ios18.0-simulator -sdk "$sdk" -module-cache-path "$PWD/build/cache" Probe.swift -o build/M0Probe.app/M0Probe
/usr/bin/python3 - <<'PY'
import plistlib
with open('build/M0Probe.app/Info.plist','wb') as f:plistlib.dump({'CFBundleExecutable':'M0Probe','CFBundleIdentifier':'org.stationcat.m0.probe','CFBundleName':'M0 Probe','CFBundleVersion':'1','CFBundleShortVersionString':'0.0.1','CFBundlePackageType':'APPL','MinimumOSVersion':'18.0','UIDeviceFamily':[1,2],'UILaunchScreen':{},'UIBackgroundModes':['audio'],'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True}},f)
PY
codesign --force --sign - build/M0Probe.app
