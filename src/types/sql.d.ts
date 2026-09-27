/** `.sql` files are bundled as Wrangler Text modules (a default module rule). */
declare module "*.sql" {
  const sql: string;
  export default sql;
}
