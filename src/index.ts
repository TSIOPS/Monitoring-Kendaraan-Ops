export default {
  async fetch(): Promise<Response> {
    return new Response('Monitoring Kendaraan Operasional (Cloud)', { status: 200 });
  },
};