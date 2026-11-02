# The Newspaper of Us

İki kişilik özel gazete. Anılarınızı yazın, fotoğraflarını ekleyin; istediğiniz yazıları seçip eski gazete tasarımında PNG alın, indirin veya yazdırın. Her "Yeniden üret" farklı bir tasarım çıkarır. Sunucu yok, maliyet yok.

## Nasıl çalışıyor?

| Parça | Nerede | Görünürlük |
| --- | --- | --- |
| Site kodu (bu repo) | GitHub Pages, Actions ile yayınlanır | Public |
| Yazılar ve fotoğraflar | `NewspaperOfUs-data` reposu | **Private** |
| Gazete üretimi | Tarayıcının içinde (canvas) | Cihazdan çıkmaz |

Tarayıcı doğrudan GitHub API ile konuşur. İçeriğin private repoda durması, token ekranını gerçek bir kilit yapar: token yoksa GitHub içeriği vermez, kaynak koduna bakmak da işe yaramaz.

## Kurulum

### 1. İki repo oluştur

- [Private veri reposu](https://github.com/new?name=NewspaperOfUs-data&visibility=private): adı `NewspaperOfUs-data`, **Private**.
- [Public site reposu](https://github.com/new?name=NewspaperOfUs&visibility=public): adı `NewspaperOfUs`, **Public**, README eklemeden boş.

Başka kullanıcı veya repo adı kullanacaksan `src/config.ts` dosyasındaki `DATA_REPO` değerini değiştir.

### 2. Kodu gönder

Bu klasörde:

```bash
git init -b main
git add .
git commit -m "İlk sürüm"
git remote add origin https://github.com/emirhankskn/NewspaperOfUs.git
git push -u origin main
```

### 3. Pages'i aç

[Settings → Pages](https://github.com/emirhankskn/NewspaperOfUs/settings/pages) sayfasında **Source: GitHub Actions** seç. Sonra [Actions](https://github.com/emirhankskn/NewspaperOfUs/actions) sekmesinden, ilk push'ta Pages kapalı olduğu için başarısız olan "Siteyi yayınla" işini **Re-run** ile tekrar çalıştır.

Site adresi: <https://emirhankskn.github.io/NewspaperOfUs/>

### 4. Token üret

[Yeni fine-grained token](https://github.com/settings/personal-access-tokens/new) sayfasında:

- **Expiration:** 90 gün önerilir; süresi dolan token sızmış olsa bile işe yaramaz
- **Repository access:** Only select repositories → yalnızca `NewspaperOfUs-data`
- **Repository permissions → Contents:** Read and write

Çıkan `github_pat_…` değeri anahtarınızdır. Bu değeri koda veya public bir yere yazma. Daha güvenlisi iki kişiye iki ayrı token üretmektir: biri sızarsa diğerine dokunmadan iptal edilir.

Token'ın süresi dolunca site giriş ekranına döner; yenisini üretip iki cihazda da girmeniz yeter. İçerik etkilenmez.

## Kullanım

1. **Yeni yazı:** Başlık, tarih, etiketler, içerik (kalın, italik, renk, ara başlık, alıntı, liste) ve galeri. Yazarken altta tahmini sayfa sayısı görünür.
2. **Ana sayfa:** İkinizin bütün yazıları, aylara ayrılmış. Üstten başlıkta ve içerikte arayabilir, etiketlere dokunarak süzebilirsin. Gazeteye girecekleri işaretleyip **Gazete üret** de; düğme tahmini sayfa sayısını gösterir.
3. **Üretim ekranı:** Beğenmezsen **Yeniden üret**. Üstteki küçük resimlerden önceki tasarımlara dönebilirsin; aynı tasarım birebir geri gelir. Beğendiğini **PNG indir** veya **Yazdır**. Birden çok sayfa çıkarsa hepsi tek **ZIP** olarak iner; her sayfa ayrıca tek başına da indirilebilir.
4. **Kaydetme:** Beğendiğin baskıyı **Kaydet** ile özel depoya atarsın; **Kaydedilenler** bölümünde durur, oradan indirilir, yazdırılır veya silinir. Kaydedilmeyen baskılar sayfadan çıkınca kaybolur. Kayıtlar sayfa başına yaklaşık 4 MB JPEG'dir (PNG 20 MB tutardı) ve üretildiği hâliyle kalır: yazı sonradan değişse veya silinse de kayıtlı gazete değişmez.
5. **Silme:** Yazı üç kez sorularak silinir. Git geçmişinde kaldığı için gerekirse veri reposundan geri alınabilir.

Çıktı A4 oranında ve 300 DPI'dır (2480×3508). Seçim sınırı yoktur: içerik ne kadar uzunsa o kadar sayfa basılır, sığmayan yazı "Devamı 2. sayfada" ile sürer.

**Arama:** Başlık, içerik, fotoğraf altyazısı ve etiketlerde arar. Türkçe karakter ve büyük/küçük harf fark etmez ("gunes" "Güneş"i bulur). Birden çok kelime yazarsan hepsi geçen yazılar gelir.

**Etiketler:** Yeni etiket yazıyı düzenlerken oluşturulur, sonra listeden tek dokunuşla verilir. Etiket listesi yazılardan çıkar: hiçbir yazıda kalmayan etiket kendiliğinden kaybolur. Birden çok etiket seçilirse herhangi birini taşıyan yazılar gösterilir.

Yazıların kendisi dışındaki espriler (ilanlar, sloganlar, fiyat, hava durumu) `src/newspaper/copy.ts` içindedir; istediğin gibi değiştir veya yenisini ekle.

## Güvenlik

İçeriğin kapısını tarayıcı değil GitHub tutar: token olmadan API, raw ve git yolları özel repodan hiçbir şey vermez. Sitedeki giriş ekranını aşmak boş bir ekran açar, çünkü sitede içerik yoktur. Bu yüzden asıl korunması gereken token'dır.

- **Aynı origin'de başka site olmamalı.** `kullanici.github.io` altındaki bütün projeler aynı tarayıcı depolamasını paylaşır; orada çalışan bir script token'ı okuyabilir. Bu site kendi origin'inde (ayrı bir GitHub organizasyonu veya özel alt alan adı) yayınlanmalıdır.
- **Bu cihazı hatırla** yalnızca kendi cihazında işaretlenmeli. Çıkış yapınca token, taslaklar ve önbellek cihazdan silinir; diğer sekmeler de kapanır.
- **Token şüphesinde:** [token sayfasından](https://github.com/settings/personal-access-tokens) iptal et. Eski token anında geçersiz olur.
- **GitHub hesabı:** 2FA açık olmalı. Settings → Applications altında tüm repolara erişen uygulama bırakılmamalı; bunlar özel repoyu token olmadan okuyabilir.

Silinen içerik özel reponun git geçmişinde kalır.

## Geliştirme

```bash
npm install
npm run dev          # yerel sunucu
npm test             # birim testleri
npx playwright install chromium webkit
npm run test:e2e     # sahte GitHub API ile uçtan uca testler

# GitHub olmadan örnek gazete üretir
node scripts/render-samples.mjs --photos <foto-klasörü> --out <çıktı-klasörü>

# Sayfa tahminini gerçek dizgiyle karşılaştırır (yerleşim kodu değişince çalıştır)
npm run calibrate
```
