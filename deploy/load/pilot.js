import { check, fail, sleep } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const BOT_TOKEN = __ENV.BOT_TOKEN || 'load-stand-bot-token-not-secret';
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || 'load-stand-webhook-secret';
const PROFILE = __ENV.PROFILE || 'short';
const DURATION = { short: '2m', full: '15m' }[PROFILE];
if (!DURATION) throw new Error(`Unknown PROFILE ${PROFILE}, expected short or full`);

const GUESTS = 500;
const GUEST_ID_BASE = 1000000;
const OWNER_ID_BASE = 900000;
const VENUES = 10;
const ITEMS_PER_VENUE = 40;
const POINT = { lat: 55.7887, lon: 49.1221 };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOOKING_CONFLICTS = ['deal_sold_out', 'booking_exists', 'too_many_bookings'];
const MEALS = ['овсянка с бананом', 'гречка с курицей', 'борщ со сметаной', 'кофе с молоком', 'салат цезарь'];

const bookingStatuses = http.expectedStatuses(201, 409);
const mealStatuses = http.expectedStatuses(200, 201);

function arrival(rate, preAllocatedVUs, maxVUs, scenarioFunction) {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs,
    maxVUs,
    exec: scenarioFunction,
  };
}

export const options = {
  setupTimeout: '3m',
  scenarios: {
    catalog: { executor: 'constant-vus', vus: 50, duration: DURATION, exec: 'catalog' },
    bookings: arrival(5, 20, 100, 'bookings'),
    redeem: arrival(1, 5, 30, 'redeem'),
    webhook: arrival(20, 20, 100, 'webhook'),
    meals: arrival(2, 10, 50, 'meals'),
  },
  thresholds: {
    'http_req_duration{scenario:catalog}': ['p(95)<800'],
    'http_req_failed{scenario:catalog}': ['rate<0.01'],
    'http_req_duration{scenario:bookings}': ['p(95)<1000'],
    'http_req_failed{scenario:bookings}': ['rate<0.01'],
    'http_req_duration{scenario:redeem}': ['p(95)<500'],
    'http_req_failed{scenario:redeem}': ['rate<0.01'],
    'http_req_duration{scenario:webhook}': ['p(99)<1000'],
    'checks{scenario:webhook}': ['rate==1'],
    'http_req_duration{scenario:meals}': ['p(95)<1500'],
    'http_req_failed{scenario:meals}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function signInitData(userId) {
  const fields = [
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `load-${userId}`],
    ['user', JSON.stringify({ id: userId, first_name: `Load ${userId}`, language_code: 'ru' })],
  ].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const secret = crypto.hmac('sha256', 'WebAppData', BOT_TOKEN, 'binary');
  const hash = crypto.hmac('sha256', secret, fields.map(([key, value]) => `${key}=${value}`).join('\n'), 'hex');
  return [...fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`), `hash=${hash}`].join('&');
}

function clientAddress(index) {
  return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
}

function signIn(userIds, offset) {
  const responses = http.batch(
    userIds.map((id, index) => ({
      method: 'POST',
      url: `${BASE_URL}/api/v1/auth/max`,
      body: JSON.stringify({ initData: signInitData(id) }),
      params: {
        headers: { 'content-type': 'application/json', 'x-forwarded-for': clientAddress(offset + index + 1) },
        tags: { name: 'POST /api/v1/auth/max' },
      },
    })),
  );
  return responses.map((response, index) => {
    if (response.status !== 200) fail(`sign in of ${userIds[index]} failed with ${response.status}: ${response.body}`);
    return response.json('token');
  });
}

export function setup() {
  const guestIds = Array.from({ length: GUESTS }, (_, index) => GUEST_ID_BASE + index + 1);
  const ownerIds = Array.from({ length: VENUES }, (_, index) => OWNER_ID_BASE + index + 1);
  const guests = [];
  for (let start = 0; start < guestIds.length; start += 25) {
    guests.push(...signIn(guestIds.slice(start, start + 25), start));
  }
  const owners = signIn(ownerIds, GUESTS);
  return { guests, owners };
}

function auth(token, name, extra = {}) {
  return { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, tags: { name }, ...extra };
}

function randomIndex(size) {
  return Math.floor(Math.random() * size);
}

const query = `lat=${POINT.lat}&lon=${POINT.lon}`;

export function catalog(data) {
  const token = data.guests[(exec.vu.idInTest - 1) % GUESTS];
  const deals = http.get(`${BASE_URL}/api/v1/deals?${query}`, auth(token, 'GET /api/v1/deals'));
  check(deals, { 'deals 200': (response) => response.status === 200 });
  const venueId = 1 + randomIndex(VENUES);
  const venue = http.get(`${BASE_URL}/api/v1/venues/${venueId}?${query}`, auth(token, 'GET /api/v1/venues/{id}'));
  check(venue, { 'venue 200': (response) => response.status === 200 });
  const recommendations = http.get(
    `${BASE_URL}/api/v1/recommendations?${query}&limit=3`,
    auth(token, 'GET /api/v1/recommendations'),
  );
  check(recommendations, { 'recommendations 200': (response) => response.status === 200 });
  sleep(5 + Math.random() * 10);
}

export function bookings(data) {
  const token = data.guests[randomIndex(GUESTS)];
  const dealId = 1 + randomIndex(VENUES);
  const menuItemId = (dealId - 1) * ITEMS_PER_VENUE + 1;
  const created = http.post(
    `${BASE_URL}/api/v1/bookings`,
    JSON.stringify({ menuItemId, dealId }),
    auth(token, 'POST /api/v1/bookings', { responseCallback: bookingStatuses }),
  );
  check(created, {
    'booking created or rejected by a business rule': (response) =>
      response.status === 201 || (response.status === 409 && BOOKING_CONFLICTS.includes(response.json('code'))),
  });
  if (created.status !== 201 || Math.random() >= 0.3) return;
  const cancelled = http.post(`${BASE_URL}/api/v1/bookings/${created.json('id')}/cancel`, null, {
    headers: { authorization: `Bearer ${token}` },
    tags: { name: 'POST /api/v1/bookings/{id}/cancel' },
  });
  check(cancelled, { 'booking cancelled': (response) => response.status === 200 });
}

function bookingCode(number) {
  let code = '';
  for (let digit = 0; digit < 6; digit += 1) code += CODE_ALPHABET[(number >> (5 * digit)) & 31];
  return code;
}

export function redeem(data) {
  const number = exec.scenario.iterationInTest + 1;
  const venueIndex = (number - 1) % VENUES;
  const redeemed = http.post(
    `${BASE_URL}/api/v1/venue/bookings/redeem`,
    JSON.stringify({ code: bookingCode(number) }),
    auth(data.owners[venueIndex], 'POST /api/v1/venue/bookings/redeem'),
  );
  check(redeemed, { 'booking redeemed': (response) => response.status === 200 });
}

export function webhook() {
  const userId = GUEST_ID_BASE + 1 + randomIndex(GUESTS);
  const now = Date.now();
  const update = {
    update_type: 'message_created',
    timestamp: now,
    message: {
      sender: { user_id: userId, first_name: `Load ${userId}` },
      recipient: { chat_id: userId },
      body: { mid: `mid.load.${exec.vu.idInTest}.${exec.vu.iterationInScenario}.${now}`, text: '/help' },
    },
  };
  const response = http.post(`${BASE_URL}/max/webhook`, JSON.stringify(update), {
    headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': WEBHOOK_SECRET },
    tags: { name: 'POST /max/webhook' },
  });
  check(response, { 'webhook 200': (result) => result.status === 200 });
}

export function meals(data) {
  const token = data.guests[randomIndex(GUESTS)];
  const response = http.post(
    `${BASE_URL}/api/v1/diary/meals/text`,
    JSON.stringify({ description: MEALS[randomIndex(MEALS.length)] }),
    auth(token, 'POST /api/v1/diary/meals/text', { responseCallback: mealStatuses }),
  );
  check(response, { 'meal logged': (result) => result.status === 200 || result.status === 201 });
}
