import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: { availability: { executor: "per-vu-iterations", vus: 10, iterations: 20 } },
  thresholds: { http_req_failed: ["rate==0"], http_req_duration: ["p(95)<250"], checks: ["rate==1"] },
};

export default function () {
  const response = http.get("http://host.docker.internal:3003/api/locations/availability?date=" + __ENV.LAB_DATE + "&duration=2");
  check(response, {
    "HTTP 200": (res) => res.status === 200,
    "five locations": (res) => res.json("locations").length === 5,
  });
}
