// swift-tools-version: 6.0
// Code the iOS app (ios-app/) and the Mac app (mac-app/) share. Platform-neutral
// only: no UIKit, no AppKit. Tests run on the Mac with `swift test`, no
// simulator. See ../beebox/docs/plans/mac-app-shell.md.

import PackageDescription

let package = Package(
    name: "BeeBoxShared",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "BeeBoxShared", targets: ["BeeBoxShared"])
    ],
    targets: [
        .target(name: "BeeBoxShared"),
        .testTarget(name: "BeeBoxSharedTests", dependencies: ["BeeBoxShared"]),
    ]
)
