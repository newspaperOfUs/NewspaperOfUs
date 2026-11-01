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

- **Expiration:** seçebildiğin en uzun süre
- **Repository access:** Only select repositories → yalnızca `NewspaperOfUs-data`
- **Repository permissions → Contents:** Read and write

Çıkan `github_pat_…` değeri tek anahtarınızdır. İkiniz de siteye bununla girersiniz. Bu değeri koda veya public bir yere yazma.

Token'ın süresi dolunca site giriş ekranına döner; yenisini üretip iki cihazda da girmeniz yeter. İçerik etkilenmez.

## Kullanım

1. **Yeni yazı:** Başlık, tarih, içerik (kalın, italik, renk, ara başlık, alıntı, liste) ve galeri.
2. **Ana sayfa:** İkinizin bütün yazıları. Gazeteye girecekleri işaretleyip **Gazete üret** de.
3. **Üretim ekranı:** Beğenmezsen **Yeniden üret**. Üstteki küçük resimlerden önceki tasarımlara dönebilirsin; aynı tasarım birebir geri gelir. Beğendiğini **PNG indir** veya **Yazdır**.

Çıktı A4 oranında ve 300 DPI'dır (2480×3508). İçerik bir sayfaya sığmazsa gazete kendiliğinden "Devamı 2. sayfada" ile sürer.

Yazıların kendisi dışındaki espriler (ilanlar, sloganlar, fiyat, hava durumu) `src/newspaper/copy.ts` içindedir; istediğin gibi değiştir veya yenisini ekle.

## Geliştirme

```bash
npm install
npm run dev          # yerel sunucu
npm test             # birim testleri
npx playwright install chromium webkit
npm run test:e2e     # sahte GitHub API ile uçtan uca testler

# GitHub olmadan örnek gazete üretir
node scripts/render-samples.mjs --photos <foto-klasörü> --out <çıktı-klasörü>
```
