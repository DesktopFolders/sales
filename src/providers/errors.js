// Error a provider throws for anything the user should see. `detail` carries the CRM's own error
// code/description (never credentials); `help` is an optional { title, text, link, url }, shown as
// a bold title on its own line, then text, then a link labeled `link` to `url`.
export class CrmError extends Error {
  constructor(message, status = 502, detail, help) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.help = help;
  }
}
