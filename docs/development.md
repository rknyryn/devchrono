# DevChrono — Geliştirici Rehberi

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| **Dil** | TypeScript 5+ |
| **Platform** | VS Code Extension API (^1.85.0) |
| **Runtime** | Node.js 18+ |
| **Derleme** | `tsc` (tsconfig.json) |
| **Paketleme** | `vsce` (.vsix) |
| **Bağımlılık** | Yok — sadece native VS Code API ve Node.js built-ins |
| **Veri** | JSON (`.vscode/time-log.json`) |
| **UI** | VS Code Webview (HTML string + `media/summary.css` + `media/summary.js`) |

## Gereksinimler

- **VS Code:** 1.85 veya üzeri
- **Node.js:** 18 veya üzeri
- **TypeScript:** 5 veya üzeri

## Kurulum & Derleme

```bash
npm install          # Bağımlılıkları yükle
npm run watch        # TypeScript watch modu (geliştirme)
npm run compile      # Tek seferlik derleme
npx vsce package     # .vsix paketi oluştur
npx vsce publish     # Marketplace'e yayınla
```

VS Code'da debug için: projeyi aç, **F5**'e bas → Extension Development Host penceresi açılır.

## Nasıl Çalışır

Extension açıldığında workspace zamanını izlemeye başlar. Workspace kapandığında oturumu kaydeder. Beklenmedik kapanma durumunda (çökme, zorla kapanma), bir sonraki açılışta önceki oturumlar `lastHeartbeat` kullanılarak otomatik kurtarılır — kullanıcı haberdar edilmez.

Tüm veriler `.vscode/time-log.json`'da tutulur — okunabilir JSON, bulut bağlantısı gerekmez.

**Heartbeat:** Aktif oturum boyunca her 5 dakikada bir `lastHeartbeat` yazılır. Bu, orphan (sahipsiz) oturumların kurtarılmasını sağlar.

**Idle Detection:** 8 farklı VS Code olayı dinlenir. 10 dakika (varsayılan) hareketsizlik sonrası oturum duraklatılır; duraklatılan süre aktif süreye dahil edilmez.

## Mimari

| Modül | Dosya | Sorumluluk |
|-------|-------|------------|
| Giriş noktası | `src/extension.ts` | `activate()` / `deactivate()` lifecycle |
| Oturum yönetimi | `src/sessionManager.ts` | Başlat/bitir/heartbeat, orphan recovery |
| Depolama | `src/storage/logStorage.ts` | JSON okuma/yazma, şema migrasyonu |
| Özet paneli | `src/views/summaryPanel.ts` | Webview paneli, mesajlaşma |
| Git zaman çizelgesi | `src/views/gitTimelinePanel.ts` | Git commit görünümü |
| Boşta algılama | `src/idleDetector.ts` | VS Code olay dinleyicileri |
| Yardımcılar | `src/utils/timeFormatter.ts` | Süre formatlama |

## Veri Modeli

Log dosyası: `<workspace-root>/.vscode/time-log.json`

```typescript
interface Session {
  id: string;            // UUID
  startTime: string;     // ISO 8601
  endTime: string;       // ISO 8601
  duration: number;      // saniye (toplam)
  lastHeartbeat: string; // ISO 8601
  recovered: boolean;
  idleSeconds?: number;  // boşta geçen süre
  activeSeconds?: number;// aktif geçen süre
}

interface ProjectLog {
  schemaVersion: number; // şu an: 3
  projectName: string;
  projectPath: string;
  createdAt: string;
  sessions: Session[];
}
```

## Şema Migrasyonu

`schemaVersion` migration sözleşmesidir. `readLog()` okuma sırasında in-memory migrate eder:
- v1 → v2: `branch` alanı eklenir
- v2 → v3: `idleSeconds`, `activeSeconds` eklenir

## Komutlar

| Komut ID | Başlık |
|----------|--------|
| `devchrono.showSummary` | DevChrono: Show Summary |
| `devchrono.showToday` | DevChrono: Show Today |
| `devchrono.showGitTimeline` | DevChrono: Show Git Timeline |
| `devchrono.resetLog` | DevChrono: Reset Log |
