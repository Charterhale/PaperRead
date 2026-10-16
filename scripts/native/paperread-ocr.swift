import Foundation
import PDFKit
import Vision
import AppKit
// On-device OCR only for pages with no useful text layer. No network or model tokens.
guard CommandLine.arguments.count == 3, let pdf = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(2) }
let wanted = CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }
var output: [String: String] = [:]
for number in wanted {
 autoreleasepool {
  guard let page = pdf.page(at: number - 1) else { return }
  let bounds = page.bounds(for: .mediaBox), factor = min(2400 / max(bounds.width, bounds.height), 3)
  let image = page.thumbnail(of: NSSize(width: bounds.width * factor, height: bounds.height * factor), for: .mediaBox)
  var rectangle = CGRect(origin: .zero, size: image.size)
  guard let cgImage = image.cgImage(forProposedRect: &rectangle, context: nil, hints: nil) else { return }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["en-US", "zh-Hans"]
  request.usesLanguageCorrection = true
  do { try VNImageRequestHandler(cgImage: cgImage).perform([request]); output[String(number)] = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n") } catch { }
 }
}
if let data = try? JSONSerialization.data(withJSONObject: output), let text = String(data: data, encoding: .utf8) { print(text) } else { exit(3) }
