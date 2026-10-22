// swift-tools-version: 6.2
// A menu-bar app that runs the beebox Linux image in a lightweight VM through
// Apple's Containerization framework. Build the app bundle with
// scripts/build-app.sh; see README.md and
// ../research/installable-app/phase1-spike-app.md.

import PackageDescription

let package = Package(
    name: "BeeBoxMac",
    // Containerization's VM networking (vmnet) needs macOS 26. The bundle's
    // LSMinimumSystemVersion makes an older macOS refuse to open the app
    // with the system's own explanation rather than crash at launch.
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "BeeBoxMac", targets: ["BeeBoxMac"])
    ],
    dependencies: [
        // Pre-1.0 and changing between minor releases; pin exactly. The app
        // pulls the matching vminit image (ghcr.io/apple/containerization/vminit).
        .package(url: "https://github.com/apple/containerization.git", exact: "0.48.0"),
        // Code shared with the iOS app: pairing, the credential store.
        .package(path: "../apple-shared"),
    ],
    targets: [
        .executableTarget(
            name: "BeeBoxMac",
            dependencies: [
                "BeeBoxMacCore",
                .product(name: "BeeBoxShared", package: "apple-shared"),
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationOS", package: "containerization"),
                "Sparkle",
            ],
            linkerSettings: [
                // Sparkle.framework is embedded in BeeBox.app/Contents/Frameworks.
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])
            ]
        ),
        // The app's logic without AppKit or the VM, so `swift test` reaches it.
        .target(
            name: "BeeBoxMacCore",
            dependencies: [.product(name: "BeeBoxShared", package: "apple-shared")]
        ),
        .testTarget(name: "BeeBoxMacCoreTests", dependencies: ["BeeBoxMacCore"]),
        // Sparkle 2.10.0, fetched by scripts/fetch-sparkle.sh (pinned by
        // SHA-256) instead of SwiftPM's binary download, which hung here.
        .binaryTarget(name: "Sparkle", path: "Vendor/Sparkle.xcframework"),
    ]
)
