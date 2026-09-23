# Karanlık Köy

Mobil öncelikli Vampir Köylü oyun prototipi.

## Canlı oda testi

- Altı haneli oda kodu oluşturma ve farklı telefonlardan katılma
- WebSocket ile canlı oyuncu listesi ve bağlantı durumu
- Kurucunun rol sayılarını oyuncu sayısına göre ayarlaması
- Rol bilgisinin yalnızca ilgili oyuncunun telefonuna gönderilmesi
- Vampir, Köylü, Doktor, Avcı ve Muhtar sayılarını ayarlama
- Rastgele ve gizli kart dağıtımı
- İsteğe bağlı tek cihaz test akışı
- Vampir hedefi, Doktor koruması ve Avcının tek atış hakkı
- Gündüz köy oylaması ve otomatik kazanma koşulları
- Mobilde ve düşük güç koşullarında azaltılan görsel efektler

Oda sunucusu Cloudflare Durable Objects ve Hibernating WebSocket kullanır. Worker kaynakları `worker/` dizinindedir.

Canlı adres: <https://vampirkoylu.alperensenel.com>
