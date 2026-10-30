import React, { useEffect, useState } from "react";
import { api, navigate, dateLabel, money } from "./lib";
import { ErrorBox, Link, Loading, Status } from "./ui";

function Field({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} required /></label>;
}
export function Auth({ path }) {
  return path === "/profile" ? <Profile /> : <AccountForm key={path} path={path} />;
}
function AccountForm({ path }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState(null);
  const isRegister = path === "/register", isVerify = path === "/verify-phone";
  useEffect(() => { api("/auth/config").then(setConfig).catch(e => setError(e.message)); }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    const f = new FormData(event.currentTarget);
    try {
      if (isRegister) {
        const data = await api("/auth/register", { method: "POST", body: JSON.stringify({
          firstName: f.get("firstName"), lastName: f.get("lastName"), email: f.get("email"), phone: f.get("phone"),
          password: f.get("password"), passwordRepeat: f.get("passwordRepeat"), consent: f.get("consent") === "on",
        }) });
        sessionStorage.setItem("verifyEmail", f.get("email"));
        sessionStorage.removeItem("devCode");
        if (data.devCode) sessionStorage.setItem("devCode", data.devCode);
        navigate("/verify-phone");
      } else if (isVerify) {
        await api("/auth/verify-phone", { method: "POST", body: JSON.stringify({ email: f.get("email"), code: f.get("code") }) });
        sessionStorage.removeItem("devCode"); sessionStorage.removeItem("verifyEmail");
        setMessage("Демонстрационный код принят. Теперь можно войти в аккаунт.");
      } else {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
        navigate("/profile");
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const disabled = (isRegister || isVerify) && config && !config.registrationEnabled;
  return <section className="login-section section"><div className="login-card">
    <h1>{isRegister ? "Регистрация" : isVerify ? "Демонстрационное подтверждение" : "Вход в личный кабинет"}</h1>
    {error && <ErrorBox>{error}</ErrorBox>}
    {!config ? <><Loading /><button className="button" onClick={() => { setError(""); api("/auth/config").then(setConfig).catch(e=>setError(e.message)); }}>Повторить загрузку</button></> : disabled ? <>
      <p>SMS-подтверждение ещё не подключено, поэтому регистрация временно недоступна. Для выбора локации и отправки заявки аккаунт не требуется.</p>
      <Link to="/#locations" className="button primary full">Выбрать локацию</Link>
      <p><Link to="/login">Уже есть аккаунт? Войти</Link></p>
    </> : <form onSubmit={submit}>
      <p>{isRegister ? "Создайте учебный аккаунт: новые заявки, отправленные после входа, появятся в кабинете." : isVerify ? "SMS не отправляется. Используйте показанный ниже локальный код в течение пяти минут. Это не проверка владения телефоном." : "Войдите, чтобы увидеть заявки, отправленные из вашего аккаунта."}</p>
      {isRegister && <p className="panel-note">Локальный учебный режим. Используйте вымышленные контактные данные. Пароль: 12–128 символов, буквы, цифры и специальный символ.</p>}
      {message ? <><p className="success" role="status">{message}</p><Link to="/login" className="button primary full">Перейти ко входу</Link></> : <>
        {isRegister && <><Field label="Имя" name="firstName" minLength={2} maxLength={60} autoComplete="given-name" /><Field label="Фамилия" name="lastName" minLength={2} maxLength={60} autoComplete="family-name" /><Field label="Телефон Казахстана" name="phone" type="tel" placeholder="+7 700 000 00 00" autoComplete="tel" maxLength={25} /></>}
        <Field label="Email" name="email" type="email" autoComplete="email" maxLength={254} defaultValue={isVerify ? sessionStorage.getItem("verifyEmail") || "" : undefined} />
        {!isVerify && <><Field label="Пароль" name="password" type="password" minLength={isRegister ? 12 : undefined} maxLength={128} autoComplete={isRegister ? "new-password" : "current-password"} />{isRegister && <Field label="Повторите пароль" name="passwordRepeat" type="password" minLength={12} maxLength={128} autoComplete="new-password" />}</>}
        {isVerify && <><Field label="Код из шести цифр" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} />{sessionStorage.getItem("devCode") && <p className="panel-note">Локальный код: <strong>{sessionStorage.getItem("devCode")}</strong></p>}<p className="panel-note">Код истёк или потерян? Это ограничение учебного режима: повторная отправка пока не реализована. Для бронирования используйте каталог без регистрации.</p></>}
        {isRegister && <label className="check"><input name="consent" type="checkbox" required /> Согласен на сохранение введённых данных для учебного аккаунта на этом стенде. Реальные персональные данные не ввожу.</label>}
        <button className="button primary full" disabled={busy}>{busy ? "Подождите…" : isRegister ? "Зарегистрироваться" : isVerify ? "Подтвердить код" : "Войти"}</button>
      </>}
      {!isVerify && <p>{isRegister ? <Link to="/login">Уже есть аккаунт? Войти</Link> : config.registrationEnabled ? <Link to="/register">Нет аккаунта? Зарегистрироваться</Link> : "Новые аккаунты на этом стенде пока недоступны."}</p>}
      <Link to="/#locations">Перейти к бронированию без аккаунта</Link>
    </form>}
  </div></section>;
}
function Profile() {
  const [user, setUser] = useState(null), [bookings, setBookings] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function load() {
    setError(""); setBusy(true);
    try { const [profile, list] = await Promise.all([api("/profile"), api("/profile/bookings")]); setUser(profile.user); setBookings(list.bookings); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  async function logout() {
    setBusy(true); setError("");
    try { await api("/auth/logout", { method: "POST" }); navigate("/"); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="section profile-section"><div className="profile-heading"><h1>Личный кабинет</h1>{user && <button className="button" onClick={logout} disabled={busy}>Выйти</button>}</div>
    {error && <><ErrorBox>{error}</ErrorBox><p><Link to="/login">Перейти ко входу</Link></p></>}
    {!user && busy ? <Loading /> : user && <><p>{user.firstName} {user.lastName}<br />{user.email} · {user.phone}</p><div className="profile-heading"><h2>Мои заявки</h2><button className="button" disabled={busy} onClick={load}>{busy ? "Обновляем…" : "Обновить"}</button></div><p className="panel-note">Здесь видны заявки, отправленные после входа в аккаунт. Для гостевых заявок используйте сохранённую личную ссылку.</p>
      {bookings.length ? <div className="profile-bookings">{bookings.map(b => <article className="profile-booking" key={b.id}><h3>{b.locationName}</h3><Status value={b.status} /><p>{dateLabel(b.date)} · {b.startTime}–{b.endTime}<br />{money(b.totalPrice)}</p><Link className="text-link" to={`/booking/${b.publicToken}`}>Открыть заявку →</Link></article>)}</div> : <p>Заявок пока нет. Выберите площадку и отправьте первую заявку.</p>}
      <Link to="/#locations" className="button primary">Выбрать локацию</Link></>}
    {!user && !busy && <button className="button" onClick={load}>Повторить загрузку</button>}
  </section>;
}
