import bcrypt from 'bcrypt';

const users = [
  { name: 'Daniel Chavez', email: 'daniel.chavez@vaxsolutions.mx', role: 'sales_rep', password: 'danielvax' },
  { name: 'Jessica Hernandez', email: 'jessica.hernandez@vaxsolutions.mx', role: 'sales_rep', password: 'jessicavax' },
  { name: 'Jesus Velazquez', email: 'jesus.velazquez@vaxsolutions.mx', role: 'sales_rep', password: 'jesusvax' },
  { name: 'Juan Macias', email: 'juan.macias@vaxsolutions.mx', role: 'sales_rep', password: 'maciasvax' },
  { name: 'Juan Rojas', email: 'juan.rojas@vaxsolutions.mx', role: 'sales_rep', password: 'rojasvax' },
  { name: 'Thalia Orendain', email: 'thalia.orendain@vaxsolutions.mx', role: 'sales_rep', password: 'thaliavax' },
  { name: 'Luis Ortiz', email: 'luis.ortiz@vaxsolutions.mx', role: 'sales_lead', password: 'luisvax' },
  { name: 'Marco Martinez', email: 'marco.martinez@vaxsolutions.mx', role: 'sales_lead', password: 'marcovax' },
  { name: 'Blanca Rodriguez', email: 'blanca.rodriguez@vaxsolutions.mx', role: 'sales_lead', password: 'blancavax' },
  { name: 'Eduardo Chaim', email: 'eduardo.chaim@vaxsolutions.mx', role: 'sales_lead', password: 'chaimvax' },
  { name: 'Cinthia Solorio', email: 'cinthia.solorio@vaxsolutions.mx', role: 'pricing', password: 'cinthiavax' },
  { name: 'Eduardo Varela', email: 'eduardo.varela@vaxsolutions.mx', role: 'carrier_manager', password: 'varelavax' },
  { name: 'Montse Najera', email: 'montserrat.najera@vaxsolutions.mx', role: 'carrier_lead', password: 'montsevax' },
  { name: 'Paula Aya', email: 'paula.aya@vaxsolutions.mx', role: 'carrier_lead', password: 'paulavax' },
  { name: 'Andrea Vazquez', email: 'andrea.vazquez@vaxsolutions.mx', role: 'carrier_rep', password: 'andreavax' },
  { name: 'Ulises Meneses', email: 'ulises.meneses@vaxsolutions.mx', role: 'carrier_rep', password: 'ulisesvax' },
  { name: 'Juan Pablo Inzunza', email: 'juan.inzunza@vaxsolutions.mx', role: 'carrier_rep', password: 'inzunzavax' },
];

async function generateSQL() {
  console.log('-- SQL para insertar usuarios en producción');
  console.log('-- Ejecutar en la base de datos de producción\n');
  
  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    const username = user.email.split('@')[0].replace('.', '_');
    console.log(`INSERT INTO users (username, password, name, email, role, active) VALUES ('${username}', '${hash}', '${user.name}', '${user.email}', '${user.role}', true);`);
    console.log(`-- Password: ${user.password}\n`);
  }
}

generateSQL();
