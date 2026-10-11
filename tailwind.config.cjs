/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			// Apple 系统色
			colors: {
				apple: {
					canvas: "#FBFBFD",
					bg: "#F2F2F7",
					blue: "#007AFF",
					"blue-hover": "#0070EB",
					"blue-dark": "#005BB5",
					green: "#34C759",
					orange: "#FF9500",
					red: "#FF3B30",
					purple: "#5856D6",
					key: "#E5E5EA",
				},
			},
			// 实体按键：底部一条实色阴影当作按键侧面，悬停时变厚，按下时消失
			boxShadow: {
				"key-blue": "0 4px 0 #005BB5",
				"key-blue-hover": "0 6px 0 #005BB5",
				"key-gray": "0 4px 0 #E5E5EA",
				"key-gray-hover": "0 6px 0 #E5E5EA",
				"key-blue-sm": "0 3px 0 #005BB5",
				card: "0 20px 60px -15px rgba(0, 0, 0, 0.1)",
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
};
