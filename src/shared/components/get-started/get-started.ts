import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SETTINGS_LINKS } from '../../config/settings-links';
import { StartStep } from '../../domain/get-started';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { GetStartedService } from '../../services/get-started.service';

interface StepView {
  id: StartStep;
  label: string; // English phrase: the translation key
  commands: unknown[];
  query?: Record<string, string>;
  fragment?: string;
}

const STEPS: StepView[] = [
  { id: 'account', label: 'Add your first account', commands: ['/accounts'], query: { new: '1' } },
  { id: 'movement', label: 'Add your first expense or income', commands: ['/add'] },
  { id: 'features', label: 'Choose what else you want to track', commands: SETTINGS_LINKS.features.commands, fragment: SETTINGS_LINKS.features.fragment },
];

@Component({
  selector: 'app-get-started',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './get-started.html',
  styleUrl: './get-started.scss',
})
export class GetStartedComponent {
  views = STEPS;

  constructor(public started: GetStartedService) {}

  done(id: StartStep): boolean {
    return this.started.state().steps.find((s) => s.id === id)?.done ?? false;
  }
}
