import BeeBoxShared
import Foundation
import XCTest

final class PairingTransportTests: XCTestCase {
    func testEachRange() throws {
        let cases: [(String, PairingTransport)] = [
            ("https://box.example.ts.net/home", .encrypted),
            ("https://203.0.113.9/home", .encrypted),
            ("http://localhost:3210/main/test1", .localPlainHTTP),
            ("http://127.0.0.1:3210/main/test1", .localPlainHTTP),
            ("http://studio.local:3280/box", .localPlainHTTP),
            ("http://10.0.0.5/box", .localPlainHTTP),
            ("http://172.16.0.1/box", .localPlainHTTP),
            ("http://172.31.255.255/box", .localPlainHTTP),
            ("http://192.168.1.20/box", .localPlainHTTP),
            ("http://169.254.10.10/box", .localPlainHTTP),
            ("http://100.64.0.1/box", .localPlainHTTP),
            ("http://100.127.255.254/box", .localPlainHTTP),
            ("http://[::1]:3210/box", .localPlainHTTP),
            ("http://[fd7a:115c:a1e0::1]/box", .localPlainHTTP),
            ("http://[fe80::1]/box", .localPlainHTTP),
            ("http://203.0.113.9/box", .refusedPlainHTTP),
            ("http://172.32.0.1/box", .refusedPlainHTTP),
            ("http://100.128.0.1/box", .refusedPlainHTTP),
            ("http://box.example.com/home", .refusedPlainHTTP),
            ("http://10.0.0.5.example.com/box", .refusedPlainHTTP),
            ("http://[2001:db8::1]/box", .refusedPlainHTTP),
            ("ftp://box.example.com/home", .unsupportedScheme),
        ]
        for (text, expected) in cases {
            let url = try XCTUnwrap(URL(string: text), text)
            XCTAssertEqual(PairingTransport(baseURL: url), expected, text)
        }
    }

    func testOnlyEncryptedAndLocalAllowRedeem() {
        XCTAssertTrue(PairingTransport.encrypted.allowsRedeem)
        XCTAssertTrue(PairingTransport.localPlainHTTP.allowsRedeem)
        XCTAssertFalse(PairingTransport.refusedPlainHTTP.allowsRedeem)
        XCTAssertFalse(PairingTransport.unsupportedScheme.allowsRedeem)
    }
}
