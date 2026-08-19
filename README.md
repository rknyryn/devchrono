# DevChrono — VS Code Zaman Takibi Eklentisi

Sessizce projelerinizde harcanan zamanı takip edin. Hiçbir manuel kayıt, hiçbir yapılandırma gerekmiyor — açtığınız anda başlar.

---

## 🎯 Özellikler

- **Otomatik Takip:** Workspace açılırken başlar, kapanırken biter — manuel eylem gerekmez
- **Status Bar:** Alt köşede `⏱ Toplam: Xs Ydkk` formatında her zaman görünür
- **Özet Paneli:** Toplam süre, bugün, bu hafta, bu ay, son 7 gün grafiği
- **Git İzleme:** Dalları otomatik takip eder, session'ları git'e dayalı gruplandırır
- **Boşta Kalma Algılama:** 10 dakika hareketsiz kaldığında otomatik olarak duraklatır
- **Yerel Depolama:** Tüm veriler `.vscode/time-log.json`'da — bulut yok, hesap yok
- **Hafif:** Dış bağımlılık yok, sadece native VS Code API'leri

---

## 🔧 Komutlar

| Komut | Açıklama |
|-------|----------|
| **DevChrono: Show Summary** | Toplam süre, günlük/haftalık/aylık özet, grafik |
| **DevChrono: Show Today** | Bugünkü oturumlar |
| **DevChrono: Show Git Timeline** | Git commit zaman çizelgesi |
| **DevChrono: Reset Log** | Tüm log'u sıfırla (onay ister) |

**Kullanım:** Komut paletini açın (`Ctrl+Shift+P`) ve komut ismini yazın.

---

## ⚙️ Ayarlar

| Ayar | Tür | Varsayılan | Açıklama |
|------|-----|-----------|----------|
| `devchrono.statusBarMode` | string | `total` | Status bar gösterimi: `total`, `today`, `session` |
| `devchrono.showSeconds` | boolean | `false` | Saniyeyi göster/gizle |
| `devchrono.enableIdleDetection` | boolean | `true` | Boşta kalma algılama |
| `devchrono.idleTimeoutMinutes` | number | `10` | Boşta kalma eşiği (1-120 dakika) |

---
