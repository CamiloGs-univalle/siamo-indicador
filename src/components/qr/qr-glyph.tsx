/**
 * @file components/qr/qr-glyph.tsx
 * @description Componente de código QR real (escaneable).
 * Usa la librería `qrcode` para codificar el texto exacto en un QR estándar,
 * dibujado como SVG para mantener el estilo visual del resto de la app.
 */

"use client";

import QRCode from "qrcode";

interface QRGlyphProps {
  text: string;
  size?: number;
}

export function QRGlyph({ text, size = 118 }: QRGlyphProps) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 2; // zona de silencio mínima recomendada por el estándar QR
  const total = n + quiet * 2;
  const cell = size / total;

  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (data[r * n + c]) {
        rects.push(
          <rect
            key={r + "_" + c}
            x={(c + quiet) * cell}
            y={(r + quiet) * cell}
            width={cell + 0.4}
            height={cell + 0.4}
          />
        );
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: "#fff", borderRadius: 8 }}>
      <g fill="#111">{rects}</g>
    </svg>
  );
}
