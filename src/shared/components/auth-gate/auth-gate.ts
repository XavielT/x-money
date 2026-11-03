import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { AuthService } from '../../services/auth.service';
import { ApiError } from '../../data-layer/api-client';

type View = 'login' | 'signup' | 'recover';

// Full-screen sign-in / create account / recover password. Shown over the app until
// there is a session; it never shows financial data.
@Component({
  selector: 'app-auth-gate',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './auth-gate.html',
  styleUrl: './auth-gate.scss',
})
export class AuthGateComponent {
  view = signal<View>('login');
  busy = signal(false);
  error = signal('');
  lockedMinutes = signal(0);
  recovered = signal(false); // password was reset: show the sign-in hint
  askReplace = signal(false); // another account's data is on this device

  email = '';
  password = '';
  inviteCode = '';
  recoveryCodeInput = '';
  newPassword = '';
  savedCode = false;
  showPassword = false;

  constructor(public auth: AuthService) {
    this.email = auth.email();
  }

  setView(view: View): void {
    this.view.set(view);
    this.error.set('');
    this.askReplace.set(false);
  }

  private fail(e: unknown): void {
    const code = e instanceof ApiError ? e.code : 'error';
    if (e instanceof ApiError && code === 'locked') this.lockedMinutes.set(Math.ceil((e.retryAfterSeconds ?? 60) / 60));
    if (code === 'different_account') this.askReplace.set(true);
    this.error.set(code === 'network' || (e instanceof ApiError && e.status === 0) ? 'network' : code);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  submitLogin(replaceLocal = false): Promise<void> {
    return this.run(async () => {
      await this.auth.login(this.email, this.password, { replaceLocal });
      this.password = '';
    });
  }

  submitSignup(): Promise<void> {
    return this.run(async () => {
      await this.auth.signup(this.email, this.password, this.inviteCode);
      this.password = '';
      this.savedCode = false;
    });
  }

  submitRecover(): Promise<void> {
    return this.run(async () => {
      await this.auth.recover(this.email, this.recoveryCodeInput, this.newPassword);
      this.recovered.set(true);
      this.recoveryCodeInput = '';
      this.newPassword = '';
    });
  }

  // Closing the recovery-code screen: after signup it starts the session, after a
  // password reset it goes back to sign-in
  confirmCode(): Promise<void> {
    return this.run(async () => {
      if (this.recovered()) {
        this.auth.acknowledgeRecovered();
        this.recovered.set(false);
        this.setView('login');
      } else {
        await this.auth.acknowledgeRecoveryCode();
      }
      this.savedCode = false;
    });
  }
}
