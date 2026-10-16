# ЛЗ 7 Сканерлер мен тексеру дәлелі

Күні: 16.10.2026. Толық автоматты security scan әлі орындалған жоқ.

| Тексеру | Нақты нәтиже | RAID байланысы |
|---|---|---|
| Docker server readiness | docker.exe бар, Docker Desktop Linux engine named pipe табылмады | I03 |
| Trivy vulnerabilities | Скан басталмады; CVE саны белгісіз | R12 |
| Gitleaks Git тарихы | Скан басталмады; секрет жоқ деген қорытынды жасалмайды | R13 |
| User login/verify targeted probe | isolated SQLite: 7 invalid login → 7×401; auth counters 0; invalid verify attempts 0 | I01, SEC-01 |
| PostgreSQL booking suite | Алдыңғы қосылу қадамында бөлек semka_test базасында 7 тексеріс өтті | T02 бар қорғанысы |
| UI redesign browser check | Type filter, real availability query, booking date/duration transfer, login/register/admin forms, 390px viewport; browser errors жоқ | R09/R11 |

Docker қатесі: `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`. Бұл анықталған CVE емес, скан орындалмағанының себебі.

## Қайта іске қосу

Docker Desktop Linux engine іске қосылған соң, репозиторий түбірінен:

```powershell
docker run --rm -v "${PWD}:/src:ro" aquasec/trivy fs --scanners vuln --skip-dirs /src/node_modules,/src/data,/src/work --format json /src

docker run --rm -v "${PWD}:/path:ro" zricethezav/gitleaks:latest detect -s /path --redact
```

Trivy vuln-only dependency scan және Gitleaks git-history scan бөлек орындалады. Жергілікті .env/data/work секреттері скан нәтижесінде жарияланбайды. Қосымша untracked source scan керек болса, тек public source тізімін қамтып, redaction қолдану қажет. Әр команда үшін құрал/image нұсқасын, уақытын және exit code сақтау; stdout-тағы raw құпияны репозиторийге қоспау.

Нәтижеде әр finding үшін severity, файл, ID, иесі, түзету/қабылдау және мерзім жазылады. Нақты құпия табылса, алдымен оны ауыстыру керек; файлды өшіру ескі commit-тегі құпияны жоймайды. Тек осы талдаудан кейін R12/R13 статусы өзгертіледі.

Targeted reproduction есебі: [auth-observations.json](evidence/auth-observations.json). Онда код, пароль, email, телефон, cookie немесе нақты клиент дерегі жоқ. Сынақ ешбір live аккаунтты өзгертпеді.
