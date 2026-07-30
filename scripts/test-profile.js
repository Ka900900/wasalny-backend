const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'wasalny_super_secret_key_change_me';

// Captain ID from database
const captainId = 'cms54nicr0001o20pcr1ymnjg';

// Generate a token
const token = jwt.sign(
  { userId: captainId, role: 'DRIVER', id: captainId },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log(token);
