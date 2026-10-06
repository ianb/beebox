// swift-tools-version: 6.2
// Phase 1 spike: a menu-bar app that runs the beebox Linux image in a
// lightweight VM through Apple's Containerization framework. See
// ../research/installable-app/phase1-spike-app.md.

import PackageDescription

let package = Package(
    name: "BeeBoxMac",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "BeeBoxMac", targets: ["BeeBoxMac"])
    ],
    dependencies: [
        // Pre-1.0 and changing between minor releases; pin exactly.
        .package(url: "https://github.com/apple/containerization.git", exact: "0.48.0")
    ],
    targets: [
        .executableTarget(
            name: "BeeBoxMac",
            dependencies: [
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationOS", package: "containerization"),
            ]
        )
    ]
)
