import Foundation
import UIKit
import Capacitor
import VisionKit

// Native barcode scanner using Apple VisionKit's DataScannerViewController (iOS 16+).
// Shipped as its own SPM package so Capacitor auto-registers it (same path as the
// Firebase auth plugin) — app-target Swift classes are not auto-discovered.
// One-shot: scan() presents the scanner, resolves with the first barcode (or
// {cancelled:true}), and dismisses. The web layer loops scan() with qty entry between.
@objc(BistroScannerPlugin)
public class BistroScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BistroScannerPlugin"
    public let jsName = "BistroScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise)
    ]

    private var savedCall: CAPPluginCall?
    private var scannerVC: UIViewController?

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.resolve(["supported": false])
            return
        }
        DispatchQueue.main.async {
            call.resolve(["supported": DataScannerViewController.isSupported && DataScannerViewController.isAvailable])
        }
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.reject("VisionKit requires iOS 16 or later")
            return
        }
        DispatchQueue.main.async {
            guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
                call.reject("Barcode scanning is not available on this device")
                return
            }
            self.savedCall = call
            let scanner = DataScannerViewController(
                recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce, .code128, .code39, .code93, .itf14])],
                qualityLevel: .balanced,
                recognizesMultipleItems: false,
                isHighFrameRateTrackingEnabled: true,
                isPinchToZoomEnabled: true,
                isGuidanceEnabled: true,
                isHighlightingEnabled: true
            )
            scanner.delegate = self
            scanner.modalPresentationStyle = .fullScreen
            self.scannerVC = scanner

            let cancel = UIButton(type: .system)
            cancel.setTitle("Cancel", for: .normal)
            cancel.setTitleColor(.white, for: .normal)
            cancel.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            cancel.backgroundColor = UIColor(white: 0, alpha: 0.55)
            cancel.layer.cornerRadius = 18
            cancel.translatesAutoresizingMaskIntoConstraints = false
            cancel.addTarget(self, action: #selector(self.cancelTapped), for: .touchUpInside)
            scanner.view.addSubview(cancel)
            NSLayoutConstraint.activate([
                cancel.topAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.topAnchor, constant: 12),
                cancel.trailingAnchor.constraint(equalTo: scanner.view.trailingAnchor, constant: -16),
                cancel.widthAnchor.constraint(equalToConstant: 96),
                cancel.heightAnchor.constraint(equalToConstant: 36)
            ])

            self.bridge?.viewController?.present(scanner, animated: true) {
                try? scanner.startScanning()
            }
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        finish(value: nil)
        call.resolve()
    }

    @objc private func cancelTapped() {
        finish(value: nil)
    }

    private func finish(value: String?) {
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                (self.scannerVC as? DataScannerViewController)?.stopScanning()
            }
            self.scannerVC?.dismiss(animated: true)
            self.scannerVC = nil
            if let call = self.savedCall {
                call.resolve(value != nil ? ["barcode": ["rawValue": value!]] : ["cancelled": true])
                self.savedCall = nil
            }
        }
    }
}

@available(iOS 16.0, *)
extension BistroScannerPlugin: DataScannerViewControllerDelegate {
    public func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        consume(addedItems)
    }

    public func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
        consume([item])
    }

    private func consume(_ items: [RecognizedItem]) {
        for item in items {
            if case let .barcode(barcode) = item, let value = barcode.payloadStringValue, !value.isEmpty {
                finish(value: value)
                return
            }
        }
    }
}
