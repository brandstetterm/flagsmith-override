// Renders icons/icon.svg to the PNG sizes the manifest uses:
//   swift dev/render-icons.swift icons/icon.svg icons
import AppKit
let args = CommandLine.arguments
let src = URL(fileURLWithPath: args[1])
guard let image = NSImage(contentsOf: src) else { fatalError("cannot load svg") }
for size in [16, 32, 48, 128] {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(args[2])/icon-\(size).png"))
}
