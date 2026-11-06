"""Collect GitHub deployment evidence and render the four metrics from Lab 10."""

import argparse
import csv
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def utc_text(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


class GitHub:
    def __init__(self, repository):
        owner, repo = repository.split("/")
        self.base = f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}"
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "semka-lab10-dora",
        }
        if token := os.getenv("GITHUB_TOKEN"):
            self.headers["Authorization"] = f"Bearer {token}"

    def pages(self, path, **query):
        url = f"{self.base}{path}?{urlencode(query)}"
        while url:
            try:
                with urlopen(Request(url, headers=self.headers), timeout=30) as response:
                    yield json.load(response)
                    links = response.headers.get("Link", "").split(",")
            except HTTPError as error:
                message = f"GitHub API {error.code} for {url}"
                if error.headers.get("X-RateLimit-Remaining") == "0":
                    message += " (rate limit: supply a read-only GITHUB_TOKEN)"
                raise RuntimeError(message) from error
            url = next((link.split("<", 1)[1].split(">", 1)[0]
                        for link in links if 'rel="next"' in link), None)

    def collect(self, environment, start, end):
        entries = []
        for batch in self.pages("/deployments", environment=environment, per_page=100):
            for item in batch:
                if instant(item["created_at"]) >= end:
                    continue
                statuses = [s for page in self.pages(f"/deployments/{item['id']}/statuses", per_page=100)
                            for s in page if instant(s["created_at"]) < end]
                statuses.sort(key=lambda s: (instant(s["created_at"]), s["id"]))
                success = next((s for s in statuses if s["state"] == "success"), None)
                entries.append({
                    "id": item["id"], "sha": item["sha"], "requested_at": item["created_at"],
                    "success_at": success["created_at"] if success else None,
                    "log_url": success.get("log_url") if success else None,
                    "environment_url": success.get("environment_url") if success else None,
                    "status_history": [{"state": s["state"], "at": s["created_at"], "id": s["id"]} for s in statuses],
                })
        successful = sorted((row for row in entries if row["success_at"]),
                            key=lambda row: (instant(row["success_at"]), row["id"]))
        previous = None
        seen = set()
        changes = []
        for row in successful:
            sha = row["sha"]
            deployed = instant(row["success_at"])
            if deployed >= start:
                if previous is None:
                    commits = list(self.pages(f"/commits/{sha}"))
                elif previous == sha:
                    commits = []
                else:
                    commits = [commit for page in self.pages(f"/compare/{previous}...{sha}", per_page=100)
                               for commit in page["commits"]]
                for commit in commits:
                    if commit["sha"] in seen:
                        continue
                    committed_at = commit["commit"]["committer"]["date"]
                    elapsed = (deployed - instant(committed_at)).total_seconds()
                    if elapsed < 0:
                        raise ValueError(f"Deployment predates commit {commit['sha']}")
                    changes.append({"sha": commit["sha"], "committed_at": committed_at,
                                    "deployment_id": row["id"], "deployed_at": row["success_at"],
                                    "lead_seconds": elapsed})
                    seen.add(commit["sha"])
            previous = sha
            seen.add(sha)
        return entries, changes


def summarize(entries, changes, start, end, incident_log):
    deployments = [row for row in entries if row["success_at"] and start <= instant(row["success_at"]) < end]
    ids = {row["id"] for row in deployments}
    attempts = [row for row in entries if start <= instant(row["requested_at"]) < end]
    technical_failures = sum(any(s["state"] in {"error", "failure"} for s in row["status_history"])
                             for row in attempts)
    failed_ids = set()
    recovery = []
    if incident_log:
        with incident_log.open(encoding="utf-8-sig", newline="") as stream:
            for incident in csv.DictReader(stream):
                deployment_id = int(incident["deployment_id"])
                if deployment_id not in ids:
                    continue
                if deployment_id in failed_ids:
                    raise ValueError(f"Multiple incident rows for deployment {deployment_id}")
                failed_ids.add(deployment_id)
                if incident["restored_utc"]:
                    duration = (instant(incident["restored_utc"]) - instant(incident["impact_start_utc"])).total_seconds()
                    if duration < 0:
                        raise ValueError(f"Negative recovery time for deployment {deployment_id}")
                    recovery.append(duration)
    return {
        "deployments": len(deployments),
        "per_week": len(deployments) / ((end - start).total_seconds() / 604800),
        "lead_samples": len(changes),
        "lead_median_seconds": median(row["lead_seconds"] for row in changes) if changes else None,
        "technical_failures": technical_failures, "attempts": len(attempts),
        "incident_log_supplied": bool(incident_log),
        "cfr_percent": 100 * len(failed_ids) / len(deployments) if incident_log and deployments else None,
        "failed_deployments": len(failed_ids) if incident_log else None,
        "restored_incidents": len(recovery) if incident_log else None,
        "recovery_median_seconds": median(recovery) if recovery else None,
    }


def number(value):
    return f"{value:g}".replace(".", ",")


def duration(value):
    if value is None:
        return "Н/Д"
    minutes, seconds = divmod(value, 60)
    hours, minutes = divmod(minutes, 60)
    return (f"{int(hours)} ч " if hours else "") + f"{int(minutes)} мин {number(seconds)} с"


def draw_dashboard(snapshot, filename):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    metrics = snapshot["metrics"]
    start, end = instant(snapshot["from_utc"]), instant(snapshot["to_utc_exclusive"])
    success_times = [instant(row["success_at"]) for row in snapshot["deployments"] if row["success_at"]]
    weekly_starts = [start + timedelta(days=7 * index) for index in range((end - start + timedelta(days=7) - timedelta(microseconds=1)) // timedelta(days=7))]
    counts = [sum(day <= event < min(day + timedelta(days=7), end) for event in success_times)
              for day in weekly_starts]
    fig, (cards, bars) = plt.subplots(2, figsize=(10.2, 5.05), gridspec_kw={"height_ratios": [1.02, 1]})
    fig.patch.set_facecolor("#f6f8fb")
    fig.subplots_adjust(left=.075, right=.96, top=.81, bottom=.135, hspace=.39)
    fig.text(.075, .91, f"DORA   /   {snapshot['environment']}", fontsize=22, weight="bold", color="#173358")
    fig.text(.075, .855, f"Semka.kz    •    {start:%d.%m.%Y} — {(end - timedelta(microseconds=1)):%d.%m.%Y} UTC", fontsize=10, color="#455773")
    cards.set_axis_off()
    cfr = metrics["cfr_percent"]
    cards_data = (
        ("Частота", number(metrics["per_week"]) + " / нед.", f"{metrics['deployments']} публикаций"),
        ("Lead time", duration(metrics["lead_median_seconds"]), f"медиана · {metrics['lead_samples']} коммитов"),
        ("Change failure rate", "Н/Д" if cfr is None else number(cfr) + "%",
         "нет журнала инцидентов" if cfr is None else f"{metrics['failed_deployments']} изменений со сбоями"),
        ("Время восстановления", duration(metrics["recovery_median_seconds"]),
         "нет завершённых случаев" if not metrics["restored_incidents"] else f"закрыто · {metrics['restored_incidents']}"),
    )
    for index, (label, value, hint) in enumerate(cards_data):
        x = (index % 2) * .52
        y = .86 - (index // 2) * .55
        cards.text(x, y, label, fontsize=10, color="#405574", transform=cards.transAxes)
        cards.text(x, y-.16, value, fontsize=17, weight="bold", color="#173358", transform=cards.transAxes)
        cards.text(x, y-.29, hint, fontsize=8.5, color="#405574", transform=cards.transAxes)
    bars.set_facecolor("#f6f8fb")
    bars.set_title("Успешные публикации по неделям", loc="left", fontsize=11, pad=9, color="#173358", weight="bold")
    columns = bars.bar(range(len(counts)), counts, width=.52, color="#3265a8", zorder=3)
    bars.bar_label(columns, padding=3, fontsize=8, color="#173358")
    bars.set_xticks(range(len(counts)), [day.strftime("%d.%m") for day in weekly_starts])
    bars.set_ylim(0, max(counts, default=0) + .7)
    bars.yaxis.set_major_locator(plt.MaxNLocator(integer=True))
    bars.grid(axis="y", color="#dce4ef", linewidth=.75, zorder=0)
    bars.tick_params(labelsize=8, length=0, pad=5)
    bars.spines[:].set_visible(False)
    fig.text(.075, .044, f"GitHub Deployments API · технические failure/error: {metrics['technical_failures']}/{metrics['attempts']} попыток", fontsize=8, color="#455773")
    fig.savefig(filename, dpi=190)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="AASSAA17/-.kz")
    parser.add_argument("--environment", default="github-pages")
    parser.add_argument("--from-utc", default="2026-09-25")
    parser.add_argument("--to-utc", default="2026-11-06", help="Exclusive UTC boundary")
    parser.add_argument("--incident-log", type=Path, help="Complete, audited CSV for this scope and window")
    parser.add_argument("--snapshot", type=Path, help="Redraw from saved JSON without network")
    parser.add_argument("--out", type=Path, default=Path("dora-output"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.snapshot:
        snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    else:
        start, end = instant(args.from_utc), instant(args.to_utc)
        if start >= end:
            parser.error("--from-utc must be earlier than --to-utc")
        entries, changes = GitHub(args.repo).collect(args.environment, start, end)
        snapshot = {
            "repository": args.repo, "environment": args.environment,
            "from_utc": utc_text(start), "to_utc_exclusive": utc_text(end),
            "collected_utc": utc_text(datetime.now(timezone.utc)),
            "metrics": summarize(entries, changes, start, end, args.incident_log),
            "deployments": entries, "changes": changes,
        }
    (args.out / "dora-snapshot.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    draw_dashboard(snapshot, args.out / "dora-dashboard.png")
    print(json.dumps(snapshot["metrics"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
