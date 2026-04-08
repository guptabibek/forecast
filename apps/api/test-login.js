const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

async function testLogin() {
  const prisma = new PrismaClient();
  try {
    // Find tenant
    const tenant = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
    console.log('Tenant found:', tenant ? tenant.name : 'NOT FOUND');
    
    if (!tenant) {
      console.log('ERROR: Tenant not found');
      return;
    }
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } }
    });
    console.log('User found:', user ? user.email : 'NOT FOUND');
    
    if (!user) {
      console.log('ERROR: User not found');
      return;
    }
    
    // Test password
    const isValid = await bcrypt.compare('Admin123!', user.passwordHash);
    console.log('Password valid:', isValid);
    
    if (isValid) {
      console.log('\n✅ LOGIN TEST PASSED - Database and credentials are correct!');
      console.log('\nLogin Credentials:');
      console.log('  Tenant: demo');
      console.log('  Email: admin@demo.com');
      console.log('  Password: Admin123!');
    } else {
      console.log('\n❌ LOGIN TEST FAILED - Password mismatch');
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

testLogin();
