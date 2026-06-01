<script lang="ts">
	import { Button, ButtonGroup, ThemeToggle, Modal, CommandPalette, alert } from '@delightstack/components/actions';
	import type { CommandOption } from '@delightstack/components/actions';
	import {
		Stat, Chart, Table, Avatar, AvatarGroup, Timeline, TimelineItem,
		Accordion, AccordionItem, Calendar, Code, List, ListItem,
	} from '@delightstack/components/display';
	import type { ChartData, TableColumn } from '@delightstack/components/display';
	import { Progress, Callout, Toaster, toast, confetti } from '@delightstack/components/feedback';
	import { Input, Select, Toggle, Checkbox, Radio, RadioGroup, Range, Rating, Fieldset } from '@delightstack/components/form';
	import type { SelectOption } from '@delightstack/components/form';
	import {
		Tabs, Tab, Breadcrumbs, Pagination, Steps, Step,
	} from '@delightstack/components/navigation';
	import type { BreadcrumbItem } from '@delightstack/components/navigation';

	// ── State ──────────────────────────────────────────────────────────
	let activeTab = $state('overview');
	let sidebarCollapsed = $state(false);
	let activePage = $state('dashboard');
	let tablePage = $state(1);
	let tableSortBy = $state('date');
	let tableSortDir = $state<'asc' | 'desc'>('desc');
	let tableSelected = $state<typeof orders>([]);
	let orderSearch = $state('');
	let statusFilter = $state<string | undefined>(undefined);
	let drawerOpen = $state(false);
	let commandPaletteOpen = $state(false);
	let settingsOpen = $state(false);
	let calendarDate = $state<Date | undefined>(new Date());

	// Profile form
	let profileName = $state('Brian Schwabauer');
	let profileEmail = $state('brian@delightstack.com');
	let profileBio = $state('Full-stack engineer passionate about building delightful user experiences.');
	let profileRole = $state('engineering');
	let profileTheme = $state('system');
	let fontSize = $state(16);
	let userRating = $state(4);


	// Settings
	let emailNotifications = $state(true);
	let pushNotifications = $state(true);
	let smsAlerts = $state(false);
	let marketingEmails = $state(false);
	let weeklyDigest = $state(true);
	let twoFactorEnabled = $state(false);

	const breadcrumbs: BreadcrumbItem[] = [
		{ label: 'Home', href: '/' },
		{ label: 'Dashboard' },
	];

	const navItems = [
		{ id: 'dashboard', label: 'Dashboard', icon: 'grid' },
		{ id: 'analytics', label: 'Analytics', icon: 'chart' },
		{ id: 'customers', label: 'Customers', icon: 'users' },
		{ id: 'orders', label: 'Orders', icon: 'package' },
		{ id: 'products', label: 'Products', icon: 'tag' },
	];

	const commands: CommandOption[] = [
		{ id: 'new-order', title: 'Create New Order', category: 'Actions', onselect: () => toast.success('New order created', { duration: 2000 }) },
		{ id: 'export', title: 'Export Data', category: 'Actions', onselect: () => toast.info('Exporting data...', { duration: 2000 }) },
		{ id: 'notifications', title: 'View Notifications', category: 'Actions', onselect: () => { drawerOpen = true; } },
		{ id: 'overview', title: 'Go to Overview', category: 'Navigation', onselect: () => { activeTab = 'overview'; } },
		{ id: 'orders-tab', title: 'Go to Orders', category: 'Navigation', onselect: () => { activeTab = 'orders'; } },
		{ id: 'team', title: 'Go to Team', category: 'Navigation', onselect: () => { activeTab = 'team'; } },
		{ id: 'settings-tab', title: 'Go to Settings', category: 'Navigation', onselect: () => { activeTab = 'settings'; } },
	];

	const notifications = [
		{ title: 'New order received', message: 'Alice Chen placed order #ORD-7291 for $284.50', time: '2 min ago' },
		{ title: 'Shipment dispatched', message: 'Order #ORD-7290 shipped via Express', time: '1 hour ago' },
		{ title: 'User milestone', message: 'Active users surpassed 2,800', time: '3 hours ago' },
		{ title: 'Payment processed', message: 'Invoice #INV-4521 — $1,250.00 collected', time: '5 hours ago' },
		{ title: 'System update', message: 'v2.4.1 deployed to production', time: 'Yesterday' },
	];

	// ── Chart Data ─────────────────────────────────────────────────────
	const revenueData: ChartData = {
		labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
		datasets: [
			{ label: 'Revenue', data: [32000, 28000, 35000, 41000, 38000, 48000, 52000, 48352], color: 'var(--color-action)' },
			{ label: 'Expenses', data: [22000, 24000, 21000, 26000, 25000, 28000, 30000, 27000], color: 'var(--color-error)' },
		],
	};

	const categoryData: ChartData = {
		labels: ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'],
		datasets: [
			{ label: 'Sales', data: [35, 25, 20, 12, 8] },
		],
	};

	const weeklyData: ChartData = {
		labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
		datasets: [
			{ label: 'This Week', data: [120, 145, 132, 168, 155, 89, 102], color: 'var(--color-action)' },
			{ label: 'Last Week', data: [98, 110, 125, 140, 130, 95, 88], color: 'var(--color-bg-8)' },
		],
	};

	// ── Table Data ─────────────────────────────────────────────────────
	const orders = [
		{ id: 'ORD-7291', customer: 'Alice Chen', email: 'alice@example.com', status: 'Completed', amount: 284.50, date: '2026-03-12' },
		{ id: 'ORD-7290', customer: 'Marcus Johnson', email: 'marcus@example.com', status: 'Shipped', amount: 1250.00, date: '2026-03-11' },
		{ id: 'ORD-7289', customer: 'Sarah Williams', email: 'sarah@example.com', status: 'Pending', amount: 89.99, date: '2026-03-11' },
		{ id: 'ORD-7288', customer: 'David Park', email: 'david@example.com', status: 'Completed', amount: 432.00, date: '2026-03-10' },
		{ id: 'ORD-7287', customer: 'Emma Rodriguez', email: 'emma@example.com', status: 'Cancelled', amount: 167.25, date: '2026-03-10' },
		{ id: 'ORD-7286', customer: 'James Liu', email: 'james@example.com', status: 'Shipped', amount: 725.00, date: '2026-03-09' },
		{ id: 'ORD-7285', customer: 'Olivia Brown', email: 'olivia@example.com', status: 'Completed', amount: 59.99, date: '2026-03-09' },
		{ id: 'ORD-7284', customer: 'Liam Wilson', email: 'liam@example.com', status: 'Pending', amount: 340.00, date: '2026-03-08' },
		{ id: 'ORD-7283', customer: 'Sofia Garcia', email: 'sofia@example.com', status: 'Completed', amount: 198.50, date: '2026-03-08' },
		{ id: 'ORD-7282', customer: 'Noah Taylor', email: 'noah@example.com', status: 'Shipped', amount: 512.75, date: '2026-03-07' },
	];

	const columns: TableColumn<typeof orders[0]>[] = [
		{ key: 'id', label: 'Order', sortable: true, width: '120px' },
		{ key: 'customer', label: 'Customer', sortable: true },
		{ key: 'status', label: 'Status', sortable: true, width: '120px' },
		{ key: 'amount', label: 'Amount', sortable: true, align: 'right', width: '120px' },
		{ key: 'date', label: 'Date', sortable: true, width: '120px' },
	];

	const statusOptions: SelectOption[] = [
		{ value: undefined, label: 'All Statuses' },
		{ value: 'Completed', label: 'Completed' },
		{ value: 'Shipped', label: 'Shipped' },
		{ value: 'Pending', label: 'Pending' },
		{ value: 'Cancelled', label: 'Cancelled' },
	];

	const roleOptions: SelectOption[] = [
		{ value: 'engineering', label: 'Engineering' },
		{ value: 'design', label: 'Design' },
		{ value: 'product', label: 'Product Management' },
		{ value: 'marketing', label: 'Marketing' },
		{ value: 'sales', label: 'Sales' },
	];

	const teamMembers = [
		{ name: 'Alice Chen' },
		{ name: 'Marcus Johnson' },
		{ name: 'Sarah Williams' },
		{ name: 'David Park' },
		{ name: 'Emma Rodriguez' },
		{ name: 'James Liu' },
	];

	const statusColors: Record<string, string> = {
		Completed: 'var(--color-success)',
		Shipped: 'var(--color-action)',
		Pending: 'var(--color-bg-8)',
		Cancelled: 'var(--color-error)',
	};

	const filteredOrders = $derived(
		orders.filter(o => {
			if (statusFilter && o.status !== statusFilter) return false;
			if (orderSearch && !o.customer.toLowerCase().includes(orderSearch.toLowerCase()) && !o.id.toLowerCase().includes(orderSearch.toLowerCase())) return false;
			return true;
		})
	);

	function formatCurrency(n: number) {
		return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	async function handleDeleteSelected() {
		const confirmed = await alert({
			title: 'Delete Orders',
			message: `Are you sure you want to delete ${tableSelected.length} selected order(s)? This action cannot be undone.`,
			destructive: true,
			continue_text: 'Delete',
		});
		if (confirmed) {
			tableSelected = [];
			toast.success('Orders deleted successfully');
		}
	}

	async function handleSaveProfile() {
		await new Promise(r => setTimeout(r, 800));
		confetti({ particle_count: 80, spread: 60 });
		toast.success('Profile saved successfully');
	}
</script>

<svelte:window onkeydown={(e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
		e.preventDefault();
		commandPaletteOpen = true;
	}
}} />

{#snippet statusCell({ value }: { value: unknown })}
	<span class="status-dot" style="--dot-color: {statusColors[value as string] ?? 'gray'}">
		{value}
	</span>
{/snippet}

{#snippet amountCell({ value }: { value: unknown })}
	<span style="font-variant-numeric: tabular-nums;">{formatCurrency(value as number)}</span>
{/snippet}

<Toaster />
<CommandPalette bind:open={commandPaletteOpen} {commands} placeholder="Type a command..." />

<Modal bind:open={drawerOpen}>
	{#snippet header()}
		<div class="drawer-header-content">
			<h3>Notifications</h3>
			<Button size="0" outline onclick={() => { drawerOpen = false; toast.success('All marked as read'); }}>
				Mark all read
			</Button>
		</div>
	{/snippet}
	<List type="button" dense>
		{#each notifications as notif}
			<ListItem onclick={() => toast.info(notif.message, { duration: 3000 })}>
				<div class="notif-content">
					<span class="notif-title">{notif.title}</span>
					<span class="notif-message">{notif.message}</span>
					<span class="notif-time">{notif.time}</span>
				</div>
			</ListItem>
		{/each}
	</List>
</Modal>

<div class="dashboard" class:sidebar-collapsed={sidebarCollapsed}>
	<!-- ─── Sidebar ──────────────────────────────────────────────── -->
	<aside class="sidebar">
		<div class="sidebar-header">
			<svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
			</svg>
			{#if !sidebarCollapsed}
				<span class="logo-text">DelightStack</span>
			{/if}
		</div>

		<nav class="sidebar-nav">
			<List type="button" dense style="background-color: transparent; border-radius: 0; --border-inset: 0;">
				{#each navItems as item}
					<ListItem active={activePage === item.id} onclick={() => activePage = item.id}>
						<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
							{#if item.icon === 'grid'}
								<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
							{:else if item.icon === 'chart'}
								<line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
							{:else if item.icon === 'users'}
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
							{:else if item.icon === 'package'}
								<line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
							{:else if item.icon === 'tag'}
								<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
							{/if}
						</svg>
						{#if !sidebarCollapsed}
							<span>{item.label}</span>
						{/if}
					</ListItem>
				{/each}
			</List>
		</nav>

		<div class="sidebar-footer">
			{#if !sidebarCollapsed}
				<div class="storage-info">
					<div class="storage-label">
						<span>Storage</span>
						<span>7.2 / 10 GB</span>
					</div>
					<Progress value={72} circular={false} size="00" />
				</div>
			{/if}
			<Button
				transparent
				size="0"
				class="collapse-btn"
				onclick={() => sidebarCollapsed = !sidebarCollapsed}
			>
				<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style:transform={sidebarCollapsed ? 'rotate(180deg)' : ''}>
					<polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
				</svg>
				{#if !sidebarCollapsed}
					<span>Collapse</span>
				{/if}
			</Button>
		</div>
	</aside>

	<!-- ─── Main ─────────────────────────────────────────────────── -->
	<div class="main">
		<!-- Header -->
		<header class="header">
			<div class="header-left">
				<Breadcrumbs items={breadcrumbs} show_home={false} size="0" />
			</div>
			<div class="header-right">
				<Button icon transparent size="1" onclick={() => drawerOpen = true}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
					</svg>
				</Button>
				<Button icon transparent size="1" onclick={() => commandPaletteOpen = true}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
					</svg>
				</Button>
				<ThemeToggle size="1" />
				<Button icon transparent size="1" onclick={() => settingsOpen = true}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				</Button>
				<Avatar name="Brian Schwabauer" status="online" size="1" />
			</div>
		</header>

		<!-- Content -->
		<div class="content">
			<!-- Page heading -->
			<div class="page-heading">
				<div>
					<h1>Dashboard</h1>
					<p class="subtitle">Welcome back. Here's what's happening today.</p>
				</div>
				<div class="heading-actions">
					<Button outline onclick={() => toast.info('Report generating...', { duration: 2000 })}>Export</Button>
					<Button onclick={() => toast.success('New order created', { duration: 2000 })}>+ New Order</Button>
				</div>
			</div>

			<!-- Stats -->
			<div class="stats-row">
				<div class="card stat-card"><Stat value="$48,352" label="Revenue" change={12.5} change_label="vs last month" size="1" /></div>
				<div class="card stat-card"><Stat value="2,847" label="Active Users" change={8.2} change_label="vs last month" size="1" /></div>
				<div class="card stat-card"><Stat value="3.6%" label="Conversion" change={0.4} change_label="vs last month" size="1" /></div>
				<div class="card stat-card"><Stat value="23" label="Open Tickets" change={-15.3} change_label="vs last month" size="1" /></div>
			</div>

			<!-- Tab bar -->
			<Tabs bind:value={activeTab} size="1">
				<Tab value="overview" label="Overview" />
				<Tab value="orders" label="Orders" />
				<Tab value="team" label="Team" />
				<Tab value="settings" label="Settings" />
			</Tabs>

			<!-- Tab content -->
			{#if activeTab === 'overview'}
				<div class="tab-panel">
					<div class="charts-row">
						<div class="card chart-card chart-wide">
							<div class="card-header">
								<h3>Revenue & Expenses</h3>
								<ButtonGroup size="0" outline>
									<Button>Month</Button>
									<Button active>Quarter</Button>
									<Button>Year</Button>
								</ButtonGroup>
							</div>
							<Chart type="area" data={revenueData} height={280} curved show_points={false} />
						</div>
						<div class="card chart-card chart-narrow">
							<div class="card-header"><h3>Sales by Category</h3></div>
							<Chart type="donut" data={categoryData} height={280} inner_radius={0.55} />
						</div>
					</div>

					<div class="charts-row">
						<div class="card chart-card chart-narrow">
							<div class="card-header"><h3>Weekly Visitors</h3></div>
							<Chart type="bar" data={weeklyData} height={220} />
						</div>
						<div class="card chart-card chart-wide">
							<div class="card-header"><h3>Recent Activity</h3></div>
							<Timeline dense>
								<TimelineItem title="New order #ORD-7291" date="2026-03-12T14:30:00" status="complete">
									Alice Chen placed an order for $284.50
								</TimelineItem>
								<TimelineItem title="User milestone" date="2026-03-12T11:00:00" status="complete">
									Active users surpassed 2,800
								</TimelineItem>
								<TimelineItem title="Shipment dispatched" date="2026-03-11T16:45:00" status="complete">
									Order #ORD-7290 shipped via Express
								</TimelineItem>
								<TimelineItem title="System update" date="2026-03-11T09:00:00" status="active">
									v2.4.1 deployed to production
								</TimelineItem>
							</Timeline>
						</div>
					</div>

					<Callout tip title="Tip" dismissible>
						Revenue is up 12.5% this month. Consider increasing ad spend on Electronics — the top-performing category.
					</Callout>
				</div>
			{:else if activeTab === 'orders'}
				<div class="tab-panel">
					<div class="table-toolbar">
						<div class="table-filters">
							<Input type="search" placeholder="Search orders..." bind:value={orderSearch} dense size="0" />
							<Select
								value={statusFilter}
								options={statusOptions}
								placeholder="Filter status"
								onchange={({ value }) => { statusFilter = value as string | undefined; }}
								dense
							/>
							{#if tableSelected.length > 0}
								<Button size="0" error onclick={handleDeleteSelected}>
									Delete ({tableSelected.length})
								</Button>
							{/if}
						</div>
						<Button size="1" outline onclick={() => toast.info('Exporting CSV...', { duration: 2000 })}>Export CSV</Button>
					</div>
					<div class="card">
						<Table
							data={filteredOrders}
							{columns}
							bind:sort_by={tableSortBy}
							bind:sort_direction={tableSortDir}
							bind:selected={tableSelected}
							selectable
							striped
						/>
					</div>
					<div class="table-footer">
						<span class="table-info">{filteredOrders.length} orders</span>
						<Pagination bind:page={tablePage} total_pages={5} />
					</div>
				</div>
			{:else if activeTab === 'team'}
				<div class="tab-panel">
					<div class="team-section">
						<div class="card team-card">
							<div class="card-header">
								<h3>Team Members</h3>
								<AvatarGroup avatars={teamMembers.map(m => ({ name: m.name }))} size="0" max={4} />
							</div>
							<List type="button" dense>
								{#each teamMembers as member, i}
									<ListItem onclick={() => toast.info(`Viewing ${member.name}'s profile`)}>
										<Avatar name={member.name} size="1" status={i === 0 ? 'online' : i < 3 ? 'away' : 'offline'} />
										<div class="member-info">
											<span class="member-name">{member.name}</span>
											<span class="member-role">{['Lead Engineer', 'Designer', 'PM', 'Backend Dev', 'Frontend Dev', 'QA'][i]}</span>
										</div>
									</ListItem>
								{/each}
							</List>
						</div>
						<div class="card team-card">
							<div class="card-header"><h3>Project Progress</h3></div>
							<div class="progress-list">
								<div class="progress-item">
									<div class="progress-label"><span>API Redesign</span><span>85%</span></div>
									<Progress value={85} circular={false} size="0" />
								</div>
								<div class="progress-item">
									<div class="progress-label"><span>Mobile App</span><span>62%</span></div>
									<Progress value={62} circular={false} size="0" />
								</div>
								<div class="progress-item">
									<div class="progress-label"><span>Dashboard v2</span><span>41%</span></div>
									<Progress value={41} circular={false} size="0" />
								</div>
								<div class="progress-item">
									<div class="progress-label"><span>Documentation</span><span>93%</span></div>
									<Progress value={93} circular={false} size="0" success />
								</div>
							</div>

							<div class="card-header" style="margin-top: 1.5rem;"><h3>Sprint Calendar</h3></div>
							<Calendar bind:value={calendarDate} />
						</div>
					</div>
				</div>
			{:else if activeTab === 'settings'}
				<div class="tab-panel">
					<div class="settings-section">
						<!-- Profile card -->
						<div class="card settings-card">
							<div class="card-header"><h3>Profile</h3></div>
							<div class="settings-form">
								<Fieldset label="Personal Information" bordered>
									<div class="profile-photo-row">
										<Avatar name={profileName} size="3" />
										<Button outline size="0" onclick={() => toast.info('Photo upload coming soon')}>Change photo</Button>
									</div>
									<Input label="Full Name" bind:value={profileName} />
									<Input label="Email" type="email" bind:value={profileEmail} />
									<Input label="Bio" type="textarea" bind:value={profileBio} placeholder="Tell us about yourself..." />
									<Select label="Department" value={profileRole} options={roleOptions}
										onchange={({ value }) => { profileRole = value as string; }} />
								</Fieldset>
								<div class="fieldset-spacer"></div>
								<Fieldset label="Preferences" bordered>
									<RadioGroup label="Theme" bind:value={profileTheme} horizontal>
										<Radio value="light" label="Light" />
										<Radio value="dark" label="Dark" />
										<Radio value="system" label="System" />
									</RadioGroup>
									<Range label="Font Size" bind:value={fontSize} min={12} max={24} step={1} show_value format_value={(v) => `${v}px`} />
									<div class="rating-row">
										<span class="rating-label">Rate your experience</span>
										<Rating bind:value={userRating} max={5} />
									</div>
								</Fieldset>
								<div class="form-actions">
									<Button outline onclick={() => toast.info('Changes discarded')}>Cancel</Button>
									<Button onclick={handleSaveProfile}>Save Profile</Button>
								</div>
							</div>
						</div>

						<!-- Notifications & Setup card -->
						<div class="card settings-card">
							<div class="card-header"><h3>Notifications</h3></div>
							<Accordion>
								<AccordionItem title="Email">
									<div class="settings-list">
										<Toggle bind:checked={emailNotifications} label="Order updates" />
										<Toggle bind:checked={marketingEmails} label="Marketing emails" />
										<Toggle bind:checked={weeklyDigest} label="Weekly digest" />
									</div>
								</AccordionItem>
								<AccordionItem title="Push">
									<div class="settings-list">
										<Toggle bind:checked={pushNotifications} label="Desktop notifications" />
										<Toggle bind:checked={smsAlerts} label="SMS alerts" />
									</div>
								</AccordionItem>
								<AccordionItem title="Privacy">
									<div class="settings-list">
										<Checkbox bind:checked={twoFactorEnabled} label="Enable two-factor authentication" />
										<Checkbox checked={true} label="Share anonymous usage data" />
									</div>
								</AccordionItem>
							</Accordion>

							<div class="card-header" style="margin-top: 1.5rem;"><h3>Setup Progress</h3></div>
							<div class="quick-actions">
								<Steps>
									<Step label="Profile" status="complete" />
									<Step label="Billing" status="complete" />
									<Step label="Integrations" status="active" />
									<Step label="Launch" />
								</Steps>
							</div>
							<div class="code-preview">
								<Code
									code={`<script>
  import { Button, Modal } from '@delightstack/components';

  let open = $state(false);
</script>

<Button onclick={() => open = true}>
  Open Settings
</Button>

<Modal bind:open title="Settings">
  Configure your dashboard here.
</Modal>`}
									language="svelte"
									filename="App.svelte"
								/>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Settings Modal -->
<Modal bind:open={settingsOpen} title="Quick Settings" max_width="480px">
	<div class="modal-settings">
		<Input label="Display Name" bind:value={profileName} />
		<Input label="Email" type="email" bind:value={profileEmail} />
		<Select label="Department" value={profileRole} options={roleOptions}
			onchange={({ value }) => { profileRole = value as string; }} />
		<Toggle bind:checked={emailNotifications} label="Email notifications" />
		<Toggle bind:checked={pushNotifications} label="Push notifications" />
	</div>
</Modal>

<style>
	/* ─── Design Tokens ─────────────────────────────────────────── */
	.dashboard {
		color-scheme: light dark;

		--color-dashboard: #616969;
		--color-primary: #005640;
		--color-secondary: #005640;

		--color-bg: light-dark(#f5f6f8, #0d0d0d);
		--color-bg-card: light-dark(#ffffff, #161616);
		--color-bg-sidebar: light-dark(#ffffff, #111111);
		--color-bg-hover: light-dark(#f0f1f3, #1e1e1e);
		--color-bg-active: light-dark(#e8f5f0, #0d2a20);
		--color-text: light-dark(#1a1a1a, #e5e5e5);
		--color-text-muted: light-dark(#6b7280, #9ca3af);
		--color-text-active: light-dark(#005640, #00b894);
		--color-border: light-dark(#e5e7eb, #262626);
		--color-action: light-dark(#005640, #00b894);
		--color-action-text: light-dark(#ffffff, #ffffff);
		--color-error: light-dark(#ef4444, #f87171);
		--color-success: light-dark(#10b981, #34d399);
		--color-bg-subtle: light-dark(#f0f1f3, #1a1a1a);

		--color-bg-0: light-dark(#f5f6f8, #0a0a0a);
		--color-bg-1: light-dark(#f0f1f3, #111111);
		--color-bg-2: light-dark(#e5e7eb, #1a1a1a);
		--color-bg-3: light-dark(#d1d5db, #262626);
		--color-bg-8: light-dark(#6b7280, #6b7280);
		--color-bg-disabled: light-dark(#f0f1f3, #1a1a1a);
		--color-outline: light-dark(#e5e7eb, #333333);
		--color-outline-active: light-dark(#005640, #00b894);
		--color-action-active: light-dark(#004530, #00d6a4);
		--color-action-disabled: light-dark(#80ab9f, #1a4a3d);
		--color-action-text-disabled: light-dark(#c0d8d0, #4a7a6d);
		--color-text-disabled: light-dark(#9ca3af, #4b5563);
		--color-accent: light-dark(#005640, #00b894);
		--color-accent-text: light-dark(#ffffff, #ffffff);
		--color-error-text: light-dark(#ffffff, #ffffff);
		--color-success-text: light-dark(#ffffff, #ffffff);
		--color-bg-max-contrast: light-dark(#ffffff, #000000);
		--color-text-max-contrast: light-dark(#000000, #ffffff);

		--color-text-light: light-dark(#9ca3af, #e5e5e5);
		--color-text-dark: light-dark(#1a1a1a, #9ca3af);

		--radius: 10px;
		--radius-1: 2px;
		--radius-2: 5px;
		--radius-3: 10px;
		--radius-4: 20px;
		--radius-5: 20px;
		--radius-round: 1e5px;

		--font-sans: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif;
		--font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
		--font-size-00: 0.65rem;
		--font-size-0: 0.815rem;
		--font-size-1: 1rem;
		--font-size-2: 1.1rem;

		--shadow-1: 0 1px 3px rgba(0,0,0,0.06);
		--shadow-2: 0 4px 12px rgba(0,0,0,0.08);

		--layer-1: 1;
		--layer-2: 2;
		--layer-3: 3;
		--layer-4: 4;
		--layer-5: 5;
		--layer-important: 2147483647;

		--ease: cubic-bezier(0.76, 0, 0.24, 1);
		--ease-out-3: cubic-bezier(0.33, 1, 0.68, 1);
		--ease-out-5: cubic-bezier(0.22, 1, 0.36, 1);

		--sidebar-width: 240px;
	}

	/* ─── Layout ────────────────────────────────────────────────── */
	.dashboard {
		display: grid;
		grid-template-columns: var(--sidebar-width) 1fr;
		height: 100vh;
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-sans);
		font-size: 0.9rem;
		line-height: 1.5;
		transition: grid-template-columns 200ms var(--ease);
	}

	.dashboard.sidebar-collapsed {
		--sidebar-width: 64px;
	}

	/* ─── Sidebar ───────────────────────────────────────────────── */
	.sidebar {
		background: var(--color-bg-sidebar);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.25rem 1rem;
		border-bottom: 1px solid var(--color-border);
		min-height: 60px;
	}

	.logo-icon {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		color: var(--color-action);
	}

	.logo-text {
		font-weight: 700;
		font-size: 1rem;
		white-space: nowrap;
		color: var(--color-text);
	}

	.sidebar-nav {
		flex: 1;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
	}

	/* Override List/ListItem for sidebar context */
	.sidebar-nav :global(li::after) {
		content: none;
	}
	.sidebar-nav :global(li) {
		min-height: 2.5rem;
	}
	.sidebar-nav :global(li button) {
		color: var(--color-text-muted);
		gap: 0.75rem;
		font-size: 0.875rem;
	}
	.sidebar-nav :global(li:hover button) {
		color: var(--color-text);
	}
	.sidebar-nav :global(li.active button) {
		color: var(--color-text-active);
		font-weight: 500;
	}

	.nav-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.sidebar-footer {
		padding: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.sidebar-footer :global(.collapse-btn) {
		width: 100%;
		justify-content: flex-start;
		gap: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
	.sidebar-footer :global(.collapse-btn:hover) {
		color: var(--color-text);
	}
	.sidebar-footer :global(.collapse-btn svg) {
		transition: transform 200ms var(--ease);
	}

	.storage-info {
		padding: 0.75rem;
		margin-bottom: 0.25rem;
	}

	.storage-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	/* ─── Main ──────────────────────────────────────────────────── */
	.main {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-card);
		min-height: 60px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* ─── Page Heading ──────────────────────────────────────────── */
	.page-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.page-heading h1 {
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.3;
		color: var(--color-text);
	}

	.subtitle {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin-top: 0.25rem;
	}

	.heading-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	/* ─── Stats ─────────────────────────────────────────────────── */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	/* ─── Cards ─────────────────────────────────────────────────── */
	.card {
		background: var(--color-bg-card);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		overflow: hidden;
	}

	.stat-card {
		padding: 1.25rem;
	}

	.chart-card {
		padding: 1.25rem;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.card-header h3 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text);
	}

	/* ─── Tab Panels ────────────────────────────────────────────── */
	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ─── Charts ────────────────────────────────────────────────── */
	.charts-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	/* ─── Table ─────────────────────────────────────────────────── */
	.table-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.table-filters {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.table-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.table-info {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	/* ─── Status ────────────────────────────────────────────────── */
	.status-dot {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
	}

	.status-dot::before {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--dot-color);
		flex-shrink: 0;
	}

	/* ─── Team ──────────────────────────────────────────────────── */
	.team-section {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.team-card {
		padding: 1.25rem;
	}

	.member-info {
		display: flex;
		flex-direction: column;
		margin-left: 0.5rem;
	}

	.member-name {
		font-weight: 500;
		font-size: 0.875rem;
	}

	.member-role {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* ─── Progress ──────────────────────────────────────────────── */
	.progress-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.progress-item {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.progress-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	/* ─── Settings ──────────────────────────────────────────────── */
	.settings-section {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.settings-card {
		padding: 1.25rem;
	}

	.settings-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.profile-photo-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	.fieldset-spacer {
		height: 1.5rem;
	}

	.rating-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.rating-label {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
	}

	.quick-actions {
		padding: 0.5rem 0 1.5rem;
	}

	.code-preview {
		margin-top: 0.5rem;
	}

	/* ─── Drawer ────────────────────────────────────────────────── */
	.drawer-header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}
	.drawer-header-content h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.notif-content {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.notif-title {
		font-weight: 500;
		font-size: 0.875rem;
	}

	.notif-message {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.notif-time {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	/* ─── Modal ─────────────────────────────────────────────────── */
	.modal-settings {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.5rem 0;
	}

	/* ─── Responsive ────────────────────────────────────────────── */
	@media (max-width: 1200px) {
		.stats-row { grid-template-columns: repeat(2, 1fr); }
		.charts-row { grid-template-columns: 1fr; }
		.team-section { grid-template-columns: 1fr; }
		.settings-section { grid-template-columns: 1fr; }
	}

	@media (max-width: 768px) {
		.dashboard { grid-template-columns: 0px 1fr; }
		.sidebar { display: none; }
		.stats-row { grid-template-columns: 1fr 1fr; }
		.page-heading { flex-direction: column; }
	}
</style>
