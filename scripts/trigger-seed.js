// scripts/trigger-seed.js
const http = require('http');

async function main() {
  const loginPayload = JSON.stringify({ username: 'admin', password: 'admin123' });

  const loginRes = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginPayload
  });

  const loginData = await loginRes.json();
  if (!loginData.success) {
    console.error('Login failed:', loginData);
    process.exit(1);
  }

  console.log('Logged in as admin successfully.');

  const seedRes = await fetch('http://127.0.0.1:4000/api/system/seed-dummy-data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${loginData.token}`
    },
    body: JSON.stringify({ force: true })
  });

  const seedData = await seedRes.json();
  console.log('Seed response:', seedData);
}

main().catch(err => {
  console.error('Error during seed:', err);
  process.exit(1);
});
