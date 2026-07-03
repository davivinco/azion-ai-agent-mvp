import "./globals.css"

export const metadata = {
  title: "Azion AI Agent",
  description: "Internal ChatOps for Azion"
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
