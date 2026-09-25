export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Сервер недоступен. Проверьте, что приложение запущено.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "Не удалось выполнить запрос.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}
export const money = (value) =>
  new Intl.NumberFormat("ru-KZ").format(value) + " ₸";
export const statusLabels = {
  pending: "Ожидает подтверждения",
  confirmed: "Подтверждена",
  rejected: "Отклонена",
  cancelled: "Отменена",
  expired: "Срок заявки истёк",
};
export function astanaDate(offset = 0) {
  const today = new Date(Date.now() + 5 * 3600000);
  today.setUTCDate(today.getUTCDate() + offset);
  return today.toISOString().slice(0, 10);
}
export function dateLabel(date) {
  return new Date(`${date}T12:00:00+05:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Almaty",
  });
}
export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}
export const locationImage = (loc) =>
  loc.image || `/images/${loc.slug || loc.id}.svg`;
