import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, input, AT } from './helpers.mjs';
const password='Demo-password-2026!';
const account=(n=1)=>({firstName:'Учебный',lastName:'Клиент',email:`demo${n}@example.test`,phone:`+7700123400${n}`,password,passwordRepeat:password,consent:true});
async function register(f,n=1){const response=await f.api('/api/auth/register',{method:'POST',body:account(n)});assert.equal(response.status,201);assert.match(response.data.devCode,/^\d{6}$/);return response.data.devCode;}
async function verify(f,code,n=1){return f.api('/api/auth/verify-phone',{method:'POST',body:{email:account(n).email,code}});}
async function login(f,n=1){const r=await f.api('/api/auth/login',{method:'POST',body:{email:account(n).email,password}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
test('account registration, one-time demo verification, session persistence and private booking history',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.api('/api/auth/config')).data,{registrationEnabled:true,verificationMode:'local-demo'});
  assert.equal((await f.api('/api/profile/bookings')).status,401);
  const code=await register(f);
  assert.equal((await f.api('/api/auth/login',{method:'POST',body:{email:account().email,password}})).status,401);
  assert.equal((await verify(f,code)).status,200);
  assert.equal((await verify(f,code)).status,400);
  const cookie=await login(f);
  const key=randomUUID();
  const own=await f.api('/api/bookings',{method:'POST',body:input(),key,cookie});
  assert.equal(own.status,201);
  assert.equal((await f.api('/api/bookings',{method:'POST',body:input(),key,cookie})).status,200);
  assert.equal((await f.api('/api/bookings',{method:'POST',body:input(),key})).status,409,'idempotency key cannot rebind an account booking to a guest');
  const guest=await f.book(input({locationId:'garden'}));assert.equal(guest.status,201);
  await f.restart();
  const list=await f.api('/api/profile/bookings',{cookie});
  assert.equal(list.data.bookings.length,1);assert.equal(list.data.bookings[0].id,own.data.booking.id);
  assert.ok(!('phone' in list.data.bookings[0]));
  const code2=await register(f,2);assert.equal((await verify(f,code2,2)).status,200);
  const other=await login(f,2);
  assert.equal((await f.api('/api/profile/bookings',{cookie:other})).data.bookings.length,0);
  const stolenReplay=await f.api('/api/bookings',{method:'POST',body:input(),key,cookie:other});assert.equal(stolenReplay.status,409);
  f.setTime(AT+3*3600000);
  assert.equal((await f.api('/api/profile/bookings',{cookie})).data.bookings[0].status,'expired');
  await f.api('/api/auth/logout',{method:'POST',cookie});
  assert.equal((await f.api('/api/profile',{cookie})).status,401);
});
test('five wrong verification codes remain counted after rollback boundary and restart',async t=>{
  const f=await fixture(t),code=await register(f);
  const wrong=code==='111111'?'222222':'111111';
  const attempts=await Promise.all(Array.from({length:5},()=>verify(f,wrong)));
  assert.ok(attempts.every(r=>r.status===400));
  const row=await f.app.db.prepare('SELECT attempts FROM phone_verifications').get();assert.equal(row.attempts,5);
  await f.restart();assert.equal((await verify(f,code)).status,400);
});
test('client login throttling persists failed attempts, uses fixed window and survives restart',async t=>{
  const f=await fixture(t),code=await register(f);await verify(f,code);
  for(let i=0;i<5;i++){
    f.setTime(AT+i*60000);
    const r=await f.api('/api/auth/login',{method:'POST',body:{email:account().email,password:'wrong'}});assert.equal(r.status,401);
  }
  const rows=await f.app.db.prepare('SELECT failures,reset_at FROM auth_rate_limits').all();
  assert.ok(rows.every(r=>r.failures===5&&Number(r.reset_at)===AT+15*60000));
  await f.restart();
  assert.equal((await f.api('/api/auth/login',{method:'POST',body:{email:account().email,password}})).status,429);
  f.setTime(AT+15*60000);await login(f);
});
test('demo code expiry and registration validation fail without creating usable accounts',async t=>{
  const f=await fixture(t);
  for(const changes of [{consent:false},{passwordRepeat:'mismatch'},{password:'weak',passwordRepeat:'weak'},{email:'bad-email'}]){
    assert.equal((await f.api('/api/auth/register',{method:'POST',body:{...account(),...changes}})).status,400);
  }
  const code=await register(f);f.setTime(AT+5*60000);assert.equal((await verify(f,code)).status,400);
  assert.equal((await f.api('/api/auth/register',{method:'POST',body:account()})).status,409);
});
