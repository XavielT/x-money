export interface BankModel {
  id: string;
  name: string;
  short: string; // initials fallback when there is no logo image
  color: string; // brand color (approximate)
  textColor: string; // fallback badge text color
  logo?: string; // bundled logo image (public/banks/*.png)
}
