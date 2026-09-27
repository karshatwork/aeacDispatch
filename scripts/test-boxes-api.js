const http = require('http');

async function main() {
  const loginRes = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const { token } = await loginRes.json();
  
  // All boxes
  const allRes = await fetch('http://127.0.0.1:4000/api/boxes', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const allData = await allRes.json();
  console.log('All boxes count:', allData.boxes ? allData.boxes.length : 'error');

  // Hold boxes
  const holdRes = await fetch('http://127.0.0.1:4000/api/boxes?status=hold', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const holdData = await holdRes.json();
  console.log('Hold boxes count:', holdData.boxes ? holdData.boxes.length : 'error');

  // Rejected boxes
  const rejRes = await fetch('http://127.0.0.1:4000/api/boxes?status=rejected', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const rejData = await rejRes.json();
  console.log('Rejected boxes count:', rejData.boxes ? rejData.boxes.length : 'error');

  // Dispatched boxes
  const dispRes = await fetch('http://127.0.0.1:4000/api/boxes?status=dispatched', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const dispData = await dispRes.json();
  console.log('Dispatched boxes count:', dispData.boxes ? dispData.boxes.length : 'error');
}

main().catch(console.error);
