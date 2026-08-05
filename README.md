# Claude Dashboard

Panel do zarządzania workspace Claude Code (`.claude/`) — zadania, komendy, skille, agenci, hooki, cron, oraz terminal CLI z listą sesji.
Zbudowany od zera jako bezpieczna alternatywa dla `claudex` (patrz sekcja "Czym się różni od claudex" niżej).
Wielojęzyczny (PL/EN/DE/ES), z łatwym dodawaniem kolejnych języków. Logowanie przez konta systemowe (PAM), nie przez jedno wspólne hasło.

## Języki

Przełącznik języka jest w headerze (i na ekranie logowania). Domyślny język
dobiera się automatycznie z ustawień przeglądarki, wybór zapamiętuje się
w `localStorage`.

**Dodanie nowego języka nie wymaga zmian w kodzie JS:**
1. Skopiuj `web/i18n/en.json` na `web/i18n/<kod>.json` (np. `fr.json`) i przetłumacz wartości.
2. W `web/i18n.js` dopisz `<kod>` do `SUPPORTED_LANGS` i jego etykietę do `LANG_LABELS`.

Brakujący klucz w danym języku automatycznie spada na angielski (`en.json`
pełni rolę fallbacku), więc częściowe tłumaczenie nie psuje interfejsu.

## Instalacja zależności (wymaga kompilacji natywnych modułów)

Dwa pakiety (`authenticate-pam` — logowanie systemowe, `node-pty` — terminal CLI)
kompilują się przy instalacji. Zainstaluj najpierw nagłówki i narzędzia
budowania:

**AlmaLinux / RHEL (Twój serwer):**
```bash
sudo dnf install -y pam-devel gcc-c++ make python3
```

**Ubuntu / Debian:**
```bash
sudo apt install -y libpam0g-dev build-essential python3
```

Dopiero potem:
```bash
npm install
cp .env.example .env
```

## Logowanie systemowe (PAM)

Panel loguje przez **prawdziwe konta systemowe Linux** — ten sam login+hasło
co przy SSH — zamiast jednego wspólnego hasła do panelu. `AUTH_USERS` w `.env`
to whitelist: tylko wymienione tam konta mogą się zalogować, nawet jeśli inne
konto systemowe ma poprawne hasło.

```
AUTH_USERS=adam,ania
```

**Wymóg systemowy — grupa `shadow`:** PAM (a dokładnie pomocniczy program
`unix_chkpwd`) z założenia pozwala procesowi bez uprawnień sprawdzić hasło
**tylko własnego użytkownika**. Żeby panel mógł logować konta z whitelisty
inne niż to, na którym sam działa, proces node musi być rootem **albo**
członkiem grupy `shadow`:

```bash
sudo usermod -aG shadow twoj-user-uslugi
```

(To sprawdziłem eksperymentalnie: bez członkostwa w `shadow` logowanie
działa tylko dla samego siebie, a próba zalogowania innego konta z whitelisty
kończy się błędem uwierzytelniania mimo poprawnego hasła.)

## Cron

Zakładka "Cron" edytuje crontab **konta, na którym działa proces panelu**
(ustawionego w `User=` w pliku systemd) — nie crontab konta, którym akurat
ktoś się zalogował przez PAM. To dwie oddzielne tożsamości. Zapis przechodzi
przez systemowe `crontab -`, z walidacją składni linii przed zapisem — błędna
linia jest odrzucana, a poprzedni crontab zostaje nietknięty.

## CLI (terminal Claude Code w przeglądarce)

Sidebar ma sekcję "+ Nowy czat" i listę zapisanych sesji poniżej separatora.
Kliknięcie otwiera prawdziwy terminal (xterm.js + `node-pty` po WebSocket)
uruchamiający `claude` w katalogu `WORKSPACE_DIR`:
- **Nowy czat** → `claude` (świeża sesja)
- **Sesja z listy** → `claude --resume <id>` (wznowienie)

**Ważne ograniczenie, świadome:** oficjalna dokumentacja Claude Code wprost
zaznacza, że format wewnętrzny plików transkryptu (`~/.claude/projects/.../*.jsonl`)
zmienia się między wersjami i nie należy go parsować bezpośrednio. Dlatego
lista sesji w tym panelu pokazuje **tylko ID sesji i czas ostatniej
modyfikacji** (bezpieczne metadane pliku) — nie tytuł ani podsumowanie
rozmowy, bo to wymagałoby czytania wnętrza pliku wbrew tej rekomendacji.

Wymagania: `claude` CLI musi być zainstalowane i w `PATH` konta, na którym
działa panel. xterm.js jest ładowany z CDN (`cdn.jsdelivr.net`) — przeglądarka
użytkownika musi mieć do niego dostęp.

## Trzy tryby pracy

Panel ma trzy jawne tryby (`EXPOSURE` w `.env`) — serwer **odmawia startu**,
jeśli `EXPOSURE` i `HOST` do siebie nie pasują, żeby nie dało się przypadkiem
wystawić czegoś bez autoryzacji.

| EXPOSURE | HOST | Logowanie | Kiedy używać |
|---|---|---|---|
| `local` | musi być `127.0.0.1` | opcjonalne | tylko na tej maszynie |
| `lan` | musi być Twoim realnym adresem LAN (np. `192.168.1.100`) | **wymagane** | dostęp z innych urządzeń w domu/biurze, bez domeny |
| `world` | musi być `127.0.0.1` | **wymagane** | dostęp z internetu przez Twoją domenę, przez Caddy |

## Szybki start (tryb LAN — sieć lokalna)

```bash
npm install
cp .env.example .env
```

Edytuj `.env` — **koniecznie zmień `HOST` na swój prawdziwy adres LAN**
(sprawdzisz przez `ip addr` albo `hostname -I` na serwerze):
```
WORKSPACE_DIR=/home/adam  ( wskazuje na /home/adam/.claude )  
EXPOSURE=lan
HOST=192.168.1.100
PORT=4200
AUTH_USERS=twoj-login-systemowy
SESSION_SECRET=<openssl rand -hex 32>
```

```bash
npm start
```

Otwórz `http://192.168.1.100:4200` z dowolnego urządzenia w tej samej sieci.

Jeśli chcesz uruchomić panel wyłącznie na tym samym komputerze (bez dostępu
z innych urządzeń), ustaw `EXPOSURE=local` i `HOST=127.0.0.1` — wtedy logowanie
jest opcjonalne, bo dostęp i tak gwarantuje sam bind na loopback.

## Tryb World (dostęp z internetu przez Twoją domenę)

**Nigdy nie wystawiaj portu node'a bezpośrednio do internetu.** Node nasłuchuje
tylko lokalnie na serwerze, a ruch TLS/domenę obsługuje Caddy jako reverse proxy —
zgodnie z Twoim obecnym stackiem (Caddy + LiteCP na AlmaLinux 9).

1. W `.env` ustaw:
   ```
   EXPOSURE=world
   HOST=127.0.0.1
   AUTH_USERS=twoj-login-systemowy
   SESSION_SECRET=<openssl rand -hex 32>
   ```
2. Dodaj wpis w Caddy (przykład — dostosuj do swojej konfiguracji),
   podmieniając subdomenę na docelową:
   ```
   panel.twojadomena.pl {
       reverse_proxy 127.0.0.1:4200
   }
   ```
   Caddy sam załatwi certyfikat TLS (Let's Encrypt) — nic więcej nie trzeba robić.
3. Uruchom jako usługę (systemd), żeby przeżyło restart serwera — patrz sekcja niżej.

Ważne: w trybie `world` autoryzacja **nie** opiera się na sprawdzaniu adresu IP
żądania (bo za reverse proxy każde żądanie, także z internetu, i tak dociera
do node'a jako `127.0.0.1`) — logowanie i sesja są wymuszane zawsze, niezależnie
od tego skąd przyszło żądanie. To samo dotyczy WebSocketa terminala CLI —
autoryzacja jest sprawdzana na poziomie HTTP przed dokończeniem handshake.

## Uruchomienie jako usługa systemd

Jeśli chcesz logować konta inne niż to, na którym działa usługa, dodaj
`SupplementaryGroups=shadow` (patrz sekcja "Logowanie systemowe (PAM)" wyżej).

```ini
# /etc/systemd/system/claude-dashboard.service
[Unit]
Description=Claude Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/claude-dashboard
EnvironmentFile=/opt/claude-dashboard/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
User=twoj-user
SupplementaryGroups=shadow

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now claude-dashboard
```

## Struktura

```
server/
  index.js              # entry point, walidacja konfiguracji, CORS, bind hosta, WebSocket upgrade
  services/
    auth.js              # logowanie PAM (konta systemowe), podpisywane sesje HMAC
    workspace.js          # CRUD na plikach .claude/ (zadania/komendy/skille/agenci), ochrona przed path traversal
    cron.js               # odczyt/zapis crontabu przez systemowe narzedzie `crontab`
    cli-sessions.js        # listowanie sesji Claude Code (tylko metadane plikow)
    pty-bridge.js          # most WebSocket <-> node-pty dla terminala CLI
  routes/
    auth.js
    api.js
web/
  index.html            # panel - vanilla JS, bez build stepu
  i18n.js                # silnik tlumaczen
  i18n/{pl,en,de,es}.json
```

## Co dalej / rozbudowa

To jest świadomie okrojony szkielet — masz teraz solidny, bezpieczny fundament,
który możesz rozbudowywać razem z Claude Code:
- import/export workspace (JSON) — łatwo dodać, wzorując się na strukturze `writeConfig`/`readConfig`
- panel wielu workspace'ów naraz (obecnie jeden `WORKSPACE_DIR` na instancję)
