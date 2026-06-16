<script>
	import {
		Form,
		Input,
		Select,
		Checkbox,
		Toggle,
		Rating,
		Range,
		Radio,
		RadioGroup,
		Fieldset,
	} from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';
	import { Toaster, toast } from '@delightstack/components/feedback';

	let data = $state({
		first_name: '',
		last_name: '',
		email: '',
		password: '',
		bio: '',
		role: '',
		interests: [],
		skill: 0,
		experience_years: 0,
		plan: '',
		newsletter: false,
		terms: false,
	});

	// Hand-rolled Standard Schema — the docs app doesn't ship Zod, but any
	// Standard Schema validator (Zod, Valibot, ArkType) drops in unchanged.
	const schema = {
		'~standard': {
			version: 1,
			vendor: 'demo',
			validate(value) {
				const issues = [];
				if (!value?.first_name)
					issues.push({ path: ['first_name'], message: 'First name is required' });
				if (!value?.last_name)
					issues.push({ path: ['last_name'], message: 'Last name is required' });
				if (!value?.email || !/.+@.+\..+/.test(value.email)) {
					issues.push({ path: ['email'], message: 'Please enter a valid email address' });
				}
				if (!value?.password || value.password.length < 8) {
					issues.push({
						path: ['password'],
						message: 'Password must be at least 8 characters',
					});
				}
				if (!value?.role)
					issues.push({ path: ['role'], message: 'Please select a role' });
				if (!value?.skill)
					issues.push({ path: ['skill'], message: 'Please rate your skill level' });
				if (!value?.plan)
					issues.push({ path: ['plan'], message: 'Please choose a plan' });
				if (value?.terms !== true)
					issues.push({ path: ['terms'], message: 'You must accept the terms' });
				return issues.length ? { issues } : { value };
			},
		},
	};

	const role_options = [
		{ value: 'developer', label: 'Developer' },
		{ value: 'designer', label: 'Designer' },
		{ value: 'manager', label: 'Product Manager' },
		{ value: 'other', label: 'Other' },
	];

	const interest_options = [
		{ value: 'frontend', label: 'Frontend' },
		{ value: 'backend', label: 'Backend' },
		{ value: 'design', label: 'Design' },
		{ value: 'devops', label: 'DevOps' },
	];

	// Returning a Promise locks the form and spins the submit button until it
	// settles. reset_on_submit then clears the form on success.
	async function handleSubmit({ data }) {
		await new Promise((r) => setTimeout(r, 1200));
		toast.success(`Account created for ${data.first_name} ${data.last_name}!`);
	}

	function handleError() {
		toast.error('Please fix the errors above.');
	}
</script>

<Toaster />

<Form
	bind:data
	{schema}
	validate_on="blur"
	reset_on_submit
	onsubmit={handleSubmit}
	onerror={handleError}>
	<Fieldset label="Personal Information" bordered>
		<Input name="first_name" label="First name" />
		<Input name="last_name" label="Last name" />
		<Input name="email" label="Email" type="email" />
		<Input
			name="password"
			label="Password"
			type="password"
			description="At least 8 characters" />
		<Input
			name="bio"
			label="Bio"
			type="textarea"
			placeholder="Tell us a little about yourself…" />
	</Fieldset>

	<Fieldset label="Profile" bordered>
		<Select
			name="role"
			label="Role"
			placeholder="Select your role"
			options={role_options} />
		<Select
			name="interests"
			label="Interests"
			multiple
			clearable
			placeholder="Pick any that apply"
			options={interest_options} />
		<div style="display: flex; flex-direction: column; gap: 0.25rem;">
			<span style="font-size: 0.85em; color: var(--color-text-secondary);">
				Skill level
			</span>
			<Rating name="skill" />
		</div>
		<Range
			name="experience_years"
			label="Years of experience"
			min={0}
			max={40}
			show_value />
	</Fieldset>

	<Fieldset label="Preferences" bordered>
		<RadioGroup name="plan" label="Plan">
			<Radio value="free" label="Free" />
			<Radio value="pro" label="Pro" />
			<Radio value="enterprise" label="Enterprise" />
		</RadioGroup>
		<Toggle name="newsletter" label="Subscribe to the newsletter" />
		<Checkbox name="terms" label="I agree to the terms and conditions" />
	</Fieldset>

	<div style="display: flex; gap: 1rem;">
		<Button type="reset" ghost>Reset</Button>
		<Button type="submit">Create Account</Button>
	</div>
</Form>
