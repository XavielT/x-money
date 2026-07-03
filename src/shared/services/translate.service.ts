import { Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';

export type AppLanguage = 'en' | 'es';

// English text is the key; Spanish lives here. Unknown keys fall back to English.
const ES: Record<string, string> = {
  // Navbar
  'Home': 'Inicio',
  'History': 'Historial',
  'Stats': 'Gráficas',
  'Budgets': 'Presupuestos',
  // Home
  'Total balance': 'Balance total',
  'income': 'ingresos',
  'expenses': 'gastos',
  'No movements yet.': 'Aún no hay movimientos.',
  'Add your first transaction': 'Agrega tu primera transacción',
  'Top spending': 'Mayores gastos',
  'See stats': 'Ver gráficas',
  'Recent': 'Recientes',
  'See all': 'Ver todo',
  'of budget used': 'del presupuesto usado',
  // Transactions
  'Transactions': 'Transacciones',
  'Income': 'Ingresos',
  'Expenses': 'Gastos',
  'Net': 'Neto',
  'No transactions this month.': 'No hay transacciones este mes.',
  'Add transaction': 'Agregar transacción',
  'Search note or category…': 'Buscar nota o categoría…',
  'All categories': 'Todas las categorías',
  'All accounts': 'Todas las cuentas',
  'Transfer': 'Transferencia',
  // Form
  'New transaction': 'Nueva transacción',
  'Edit transaction': 'Editar transacción',
  'Expense': 'Gasto',
  'Amount': 'Monto',
  'Category': 'Categoría',
  'Account': 'Cuenta',
  'From account': 'Cuenta origen',
  'To account': 'Cuenta destino',
  'Date': 'Fecha',
  'Repeat': 'Repetir',
  'Never': 'Nunca',
  'Every day': 'Cada día',
  'Every week': 'Cada semana',
  'Every month': 'Cada mes',
  'Every year': 'Cada año',
  'Note (optional)': 'Nota (opcional)',
  'Bank fee / tax (optional)': 'Comisión / impuesto del banco (opcional)',
  'The bank discounts it with the movement (DGII 0.15%, commissions...).':
    'El banco lo descuenta junto al movimiento (DGII 0.15%, comisiones...).',
  'fee': 'comisión',
  'e.g. Lunch with friends': 'ej. Almuerzo con amigos',
  'Add recurring transaction': 'Agregar transacción recurrente',
  'Save changes': 'Guardar cambios',
  'Delete': 'Eliminar',
  'New': 'Nueva',
  'Category name': 'Nombre de la categoría',
  'Create category': 'Crear categoría',
  'Delete this transaction?': '¿Eliminar esta transacción?',
  // Stats
  'Nothing to show for this month.': 'Nada que mostrar este mes.',
  'Nothing to show for this period.': 'Nada que mostrar en este período.',
  'spent': 'gastado',
  'earned': 'ganado',
  'Last 6 months': 'Últimos 6 meses',
  'Month': 'Mes',
  'Year': 'Año',
  'Yearly report': 'Reporte anual',
  'Avg/month': 'Prom./mes',
  'Insights': 'Análisis',
  'Ant expenses': 'Gastos hormiga',
  'small purchases add up to': 'compras pequeñas suman',
  'of your expenses this month': 'de tus gastos este mes',
  'Recurring payments': 'Pagos recurrentes',
  'active services cost you': 'servicios activos te cuestan',
  'per month': 'al mes',
  'per year': 'al año',
  'Review services you no longer use.': 'Revisa los servicios que ya no usas.',
  'Spending up': 'Gasto en aumento',
  'Good job': 'Buen trabajo',
  'You have spent': 'Has gastado',
  'more than last month': 'más que el mes pasado',
  'less than last month': 'menos que el mes pasado',
  'Keep registering movements to unlock insights.': 'Sigue registrando movimientos para desbloquear análisis.',
  // Budgets
  'Choose category…': 'Elige categoría…',
  'Monthly limit': 'Límite mensual',
  'Set budget': 'Definir presupuesto',
  'No budgets yet. Pick a category and set a monthly limit.':
    'Sin presupuestos aún. Elige una categoría y define un límite mensual.',
  'limit': 'límite',
  'Over budget by': 'Excedido por',
  'Remove this budget?': '¿Eliminar este presupuesto?',
  // Settings
  'Settings': 'Ajustes',
  'Currency': 'Moneda',
  'Language': 'Idioma',
  'Accounts': 'Cuentas',
  'Balance:': 'Balance:',
  'Account name': 'Nombre de la cuenta',
  'Initial balance': 'Balance inicial',
  'Add account': 'Agregar cuenta',
  'Manage accounts': 'Administrar cuentas',
  'Banks, cards, cash and balances': 'Bancos, tarjetas, efectivo y balances',
  'New account': 'Nueva cuenta',
  'Edit account': 'Editar cuenta',
  'Account type': 'Tipo de cuenta',
  'Cash': 'Efectivo',
  'Bank account': 'Cuenta bancaria',
  'Card': 'Tarjeta',
  'Debit card': 'Tarjeta de débito',
  'Credit card': 'Tarjeta de crédito',
  'Savings': 'Ahorros',
  'Bank': 'Banco',
  'Card last 4 digits (optional)': 'Últimos 4 dígitos (opcional)',
  'e.g. Payroll account': 'ej. Cuenta de nómina',
  'Cancel': 'Cancelar',
  'Delete account': 'Eliminar cuenta',
  'Linked bank account': 'Cuenta bancaria vinculada',
  'Not linked (own money)': 'Sin vincular (dinero propio)',
  'Purchases with this card are taken from the linked bank account.':
    'Las compras con esta tarjeta se descuentan de la cuenta bancaria vinculada.',
  'You need at least one account.': 'Necesitas al menos una cuenta.',
  'Remove this account? Its transactions will keep showing as "Unknown" account.':
    '¿Eliminar esta cuenta? Sus transacciones se mostrarán como cuenta "Desconocida".',
  'Recurring transactions': 'Transacciones recurrentes',
  'None yet. When adding a transaction, set "Repeat" to make it recurring.':
    'Ninguna aún. Al agregar una transacción, usa "Repetir" para hacerla recurrente.',
  'Daily': 'Diaria',
  'Weekly': 'Semanal',
  'Monthly': 'Mensual',
  'Yearly': 'Anual',
  'next': 'próxima',
  'paused': 'pausada',
  'Save': 'Guardar',
  'Delete this recurring transaction? Already posted movements stay.':
    '¿Eliminar esta transacción recurrente? Los movimientos ya registrados se conservan.',
  'Categories': 'Categorías',
  'Create new categories from the "New" tile when adding a transaction. Custom ones can be deleted here.':
    'Crea nuevas categorías desde "Nueva" al agregar una transacción. Las personalizadas se pueden eliminar aquí.',
  'custom': 'personal',
  'Delete this category? Its transactions will show as "Unknown".':
    '¿Eliminar esta categoría? Sus transacciones se mostrarán como "Desconocida".',
  'App lock': 'Bloqueo de la app',
  'Protect the app with a PIN. It locks on start and when going to background.':
    'Protege la app con un PIN. Se bloquea al iniciar y al pasar a segundo plano.',
  'New PIN (4-8 digits)': 'Nuevo PIN (4-8 dígitos)',
  'Enable lock': 'Activar bloqueo',
  'Disable lock': 'Desactivar bloqueo',
  'Current PIN': 'PIN actual',
  'Wrong PIN': 'PIN incorrecto',
  'Enter PIN': 'Ingresa el PIN',
  'Unlock': 'Desbloquear',
  'Your data': 'Tus datos',
  'Everything is stored only on this device. Export a backup before changing phone.':
    'Todo se guarda solo en este dispositivo. Exporta un respaldo antes de cambiar de teléfono.',
  'Export backup (JSON)': 'Exportar respaldo (JSON)',
  'Export CSV (Excel)': 'Exportar CSV (Excel)',
  'Import backup': 'Importar respaldo',
  'Delete all data': 'Eliminar todos los datos',
  'Backup restored.': 'Respaldo restaurado.',
  'That file is not a valid X Money backup.': 'Ese archivo no es un respaldo válido de X Money.',
  'Delete ALL data? This cannot be undone.': '¿Eliminar TODOS los datos? Esto no se puede deshacer.',
  'Unknown': 'Desconocida',
};

@Injectable({ providedIn: 'root' })
export class TranslateService {
  private _lang = signal<AppLanguage>('en');
  lang = this._lang.asReadonly();

  constructor(private storage: StorageService) {
    this._lang.set(this.storage.get<AppLanguage>('lang', 'en'));
  }

  instant(key: string): string {
    return this._lang() === 'es' ? ES[key] ?? key : key;
  }

  // Locale for date formatting (month names, weekdays)
  locale(): string {
    return this._lang() === 'es' ? 'es' : 'en-US';
  }

  // Language changes are rare: persist and let the caller reload the app so
  // every pure pipe re-evaluates
  setLanguage(lang: AppLanguage): void {
    this.storage.set('lang', lang);
  }
}
