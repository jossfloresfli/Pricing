import bcrypt from 'bcrypt';
import pg from 'pg';

const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);
    
    await client.query("DELETE FROM users WHERE username = 'admin'");
    await client.query(
      "INSERT INTO users (username, password, name, email, role, active) VALUES ($1, $2, $3, $4, $5, $6)",
      ['admin', hash, 'Administrador', 'admin@vax.com', 'superadmin', true]
    );
    
    console.log('Admin user created successfully');
    console.log('Hash used:', hash);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
