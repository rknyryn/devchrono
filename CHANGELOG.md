# Changelog

## [Unreleased]
### Added
- **Branch switch session isolation** (`v2.2`): Branch geçişlerinde mevcut session otomatik kapatılır, yeni branch için yeni session başlatılır. Summary Panel artık her branch için ayrı satır gösterir.
  - `gitTracker.ts` — `.git/HEAD` ve vscode.git API üzerinden branch değişimi algılanır (300ms debounce ile rebase/geçici state koruması)
  - `sessionManager.ts` — `splitSession(newBranch)` fonksiyonu eklendi; timer ve status bar dokunulmadan session bölünür
  - **Bugfix:** Branch geçişinde `HEAD.commit` değişimi artık sahte commit kaydı oluşturmuyor
  - **Bugfix:** `startSession` async `rev-parse` callback'i artık `splitSession` sonrası yeni session'ı ezmez

## [0.2.0] - 2026-04-25
### Added
- Status bar gösterim modu ayarı (`devchrono.statusBarMode`): `total` / `today` / `session`
- Ayar değiştirildiğinde status bar anında güncellenir
- Git commit izleme: `src/gitTracker.ts` (vscode.git API + FileSystemWatcher fallback)
- Session'a `commits?: string[]` alanı (Schema v2, migration dahil)
- Summary panelinde "Oturumlar" bölümü — session başına genişletilebilir commit listesi (hash + mesaj)
- `devchrono.showGitTimeline` komutu — tüm commit'leri tarih sıralamasıyla tablo halinde gösterir

## [0.1.0] - 2026-04-21
### Added
- Session logging (start / end / heartbeat her 5 dakikada)
- Orphan session otomatik recovery (lastHeartbeat ile endTime tamamlama)
- Status bar toplam süre göstergesi (her 60 sn güncellenir, tıklanabilir)
- Summary Panel webview (Toplam / Bugün / Bu Hafta / Bu Ay + son 7 gün bar chart)
- `.vscode/time-log.json` workspace-local depolama (atomic write)
- Komutlar: `showSummary`, `showToday`, `resetLog`
- Schema versiyonlama altyapısı (schemaVersion)
