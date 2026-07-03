import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Navbar } from '../shared/components/navbar/navbar';
import { RecurringService } from '../shared/services/recurring.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Navbar],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // Injecting RecurringService here posts any due recurring transactions on startup
  constructor(private recurringService: RecurringService) {}
}
