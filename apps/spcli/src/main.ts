import { Command } from '@commander-js/extra-typings';

const program = new Command();

program
  .name('Sponsored Products CLI')
  .description('CLI for Amazon SP-API')
  .version('1.0.0');

program
  .command('products')
  .description('Fetch products from Amazon SP-API')
  .action(async () => {
    // const api = new AmazonSPAPI('your-access-token');
    // const products = await api.getProducts();
    const products = { name: 'test' };
    console.log('Products:', products);
  });

program.parse(process.argv);
