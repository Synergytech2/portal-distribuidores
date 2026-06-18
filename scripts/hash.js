// Genera el hash bcrypt de una contraseña y, opcionalmente, una entrada de distribuidor.
// Uso:
//   node scripts/hash.js "miContraseñaSegura"
//   node scripts/hash.js "miContraseñaSegura" robotica-sur "Robótica Sur S.L." A
import bcrypt from 'bcryptjs';

const [, , password, user, name, tier] = process.argv;
if (!password) {
  console.log('Uso: node scripts/hash.js "<contraseña>" [user] [name] [tier]');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 10);
if (user) {
  const entry = { user: user.toLowerCase(), name: name || user, tier: tier || 'SIN', hash };
  console.log('\nEntrada para DISTRIBUTORS (añádela al array):');
  console.log(JSON.stringify(entry));
} else {
  console.log('\nHash bcrypt:');
  console.log(hash);
}
