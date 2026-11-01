/**
 * Gazetenin "kendi" metinleri: slogan, küçük ilanlar, künye espirileri.
 * Sayfa boşluk kalınca bunlarla dolar; yenilerini eklemek için listeye satır yazman yeter.
 */

export const SLOGANS = [
  'Yalnızca ikimizin haberi var.',
  'İki kişilik dünyanın tek gazetesi.',
  'Her sayısı biraz daha biz.',
  'Kurulduğu günden beri taraflıdır. Sevenlerin tarafındayız.',
  'Dünyanın en küçük, en önemli gazetesi.',
  "Toprak yağmura, Emir Esfer'e yeniden...",
  "Toprak yağmura, Esfer Emir'e yeniden..."
];

export const PRICES = [
  'Fiyatı: Bir öpücük',
  'Fiyatı: İki sarılma',
  'Fiyatı: Üç iltifat',
  'Fiyatı: Bir gülümseme',
];

export const WEATHER = [
  'Kalpte parçalı güneşli, akşama doğru yer yer sarılma bekleniyor.',
  'Evin içi sıcak, dışarısı önemsiz.',
  'Hafif kahve kokulu rüzgâr. Görüş mesafesi: sen.',
];

export const SIDE_NOTES = [
  'Abonelik ömür boyudur, iptal edilemez.',
  'Bu gazete iki kişiliktir. Tiraj artırılmayacaktır.',
];

export const KICKERS = ['ÖZEL HABER', 'BİZE ÖZEL', 'FLAŞ', 'ARŞİVDEN', 'BUGÜNÜN ANISI', 'BAŞYAZI', 'GÜNÜN HABERİ'];

export const BYLINES = ['Yazan', 'Kaleme alan', 'Özel muhabirimiz', 'Haber', 'Başyazar'];

export const CAPTIONS = [
  'Objektifimizden.',
  'Gazetemiz arşivinden.',
  'Özel muhabirimizin objektifinden.',
  'O günden bir kare.',
  'Kameralarımız oradaydı.',
];

/** Boş alanı dolduran büyük panelin alt metinleri. */
export const PANEL_QUOTES = [
  'Bu gazete yalnızca iki kişi için basılmıştır.',
  'Bazı haberler manşete sığmaz; gece sigarasında anlatılır.',
  'Dünyada olup biten her şeyi başka gazeteler yazsın. Biz bizi yazarız.',
  'Yıllar sonra bu sayfayı bir kutudan çıkaracağız ve bugünü yeniden yaşayacağız.',
  'Burası boş kalmasın diye değil, unutulmasın diye yazıldı.',
];

export const STAMPS = ['ÇOK ÖZEL BASKI', 'KİŞİYE BAYA ÖZEL', 'GALİBA AŞIKLAR', 'SON(SUZ) BASKI'];

export const ADS: { head: string; body: string }[] = [
  { head: 'KAYIP', body: 'Bir adet çorap. En son çamaşır makinesinde görüldü. Bulan eve getirsin, ödül sarılarak ödenecek.' },
  { head: 'KİRALIK', body: 'Battaniyenin yarısı. Depozito: sabah kahvesi. Diğer yarısı zaten sizde.' },
  { head: 'SATILIK DEĞİL', body: 'Birlikte geçen pazar sabahları. Lütfen fiyat sormayın.' },
  { head: 'ARANIYOR', body: '“Akşama ne yesek?” sorusuna tek cümleyle cevap verebilecek kişi. Tecrübe şartı aranmaz.' },
  { head: 'DUYURU', body: 'Film seçme sırası konusundaki görüşmeler bu akşam da sonuçsuz kaldı.' },
  { head: 'TEŞEKKÜR', body: 'Çayı demleyen, battaniyeyi getiren ve son lokmayı bırakan kişiye teşekkürlerimizle.' },
  { head: 'BULUNDU', body: 'Uzaktan kumanda. Koltuğun arasındaydı. Yine.' },
  { head: 'TAVSİYE', body: 'Uzun bir günün ardından iki fincan çay. Doktorunuza danışmadan alabilirsiniz.' },
  { head: 'BORSA', body: 'Öpücük endeksi güne yükselişle başladı. Küslük tahvilleri alıcı bulamadı.' },
  { head: 'TRAFİK', body: 'Mutfaktan salona giden yolda yoğunluk var. Tek atıştırmalık için iki araç sırada.' },
  { head: 'SPOR', body: '“Kim daha çok uyudu” karşılaşmasında maç uzatmaya gitti.' },
  { head: 'NÖBETÇİ ECZANE', body: 'Yanındaki kişi. Her derde iyi gelir, gece gündüz açıktır.' },
  { head: 'ÖZEL DERS', body: 'Doğru şekilde sarılma üzerine özel ders verilir. Ücret: bir kahve.' },
  { head: 'SON DAKİKA', body: 'Birisi yine “beş dakikaya çıkıyorum” dedi. Gelişmeleri aktaracağız.' },
  { head: 'GÜNÜN SÖZÜ', body: 'Ev bir yer değil, bir kişidir.' },
  { head: 'RANDEVU', body: 'Bu akşam, her zamanki koltukta, her zamanki saatte. Geç kalan bulaşık yıkar.' },
  { head: 'DÜZELTME', body: 'Dünkü sayımızda “hiç kızmam” ifadesi sehven yer almıştır. Okurlarımızdan özür dileriz.' },
  { head: 'RESMÎ TEBLİĞ', body: 'Son dilim pizza ikiye bölünmek zorundadır. Bu karar kesindir.' },
  { head: 'YOL DURUMU', body: 'Birlikte gidilen bütün yollar açıktır. Müzik seçimi konusunda dikkatli olunuz.' },
  { head: 'FAL', body: 'Bu hafta sevdiğiniz biri size “ne düşünüyorsun?” diye soracak. “Hiç” demeyin.' },
  { head: 'MEZAT', body: 'Eski bir kapüşonlu. Sahibi değişti, iade edilmeyecek.' },
  { head: 'İŞ İLANI', body: 'Sabahları kahve yapacak eleman aranıyor. Maaş yok, ama çok seviliyor.' },
  { head: 'UYARI', body: 'Dizinin yeni bölümünü diğerini beklemeden izleyenler hakkında işlem yapılacaktır.' },
  { head: 'KAMU SPOTU', body: 'Üşüyen ayaklar sıcak bacaklara izinsiz değdirilmemelidir.' },
];
